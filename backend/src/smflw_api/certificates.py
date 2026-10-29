"""Persistence, issuance, and downloads for service-issued certificates."""

import hashlib
import json
from contextlib import closing
from datetime import UTC, datetime
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from pydantic import ValidationError

from smflw_api import repository
from smflw_api.certificate_pdf import render_certificate
from smflw_api.certificate_records import (
    Certificate,
    CertificateRecord,
    HumanCertificateRecord,
    record_digest,
    validate_record_integrity,
)
from smflw_api.settings import Settings
from smflw_api.storage import get_s3_client


def _assert_record_owner_active(settings: Settings, record: Certificate) -> UUID:
    try:
        owner_id = UUID(record.owner_id or "")
    except ValueError as exc:
        raise HTTPException(404, "Certificate not found.") from exc
    try:
        repository.assert_user_active(settings, owner_id)
    except HTTPException as exc:
        if exc.status_code in {401, 403, 404, 409, 410}:
            raise HTTPException(404, "Certificate not found.") from exc
        raise
    return owner_id


def _persist_certificate(
    settings: Settings, record: Certificate, *, register: bool = True
) -> None:
    owner_id = _assert_record_owner_active(settings, record)
    prefix = f"certificates/{owner_id}/{record.certificate_id}"
    json_key, pdf_key = f"{prefix}.json", f"{prefix}.pdf"
    verification_url = (
        f"{str(settings.public_web_url).rstrip('/')}/verify/{record.certificate_id}"
    )
    pdf = render_certificate(record, verification_url)
    written = []
    with closing(get_s3_client(settings)) as client:
        try:
            for key, body, media_type in (
                (
                    json_key,
                    record.model_dump_json().encode("utf-8"),
                    "application/json",
                ),
                (pdf_key, pdf, "application/pdf"),
            ):
                client.put_object(
                    Bucket=settings.image_bucket,
                    Key=key,
                    Body=body,
                    ContentType=media_type,
                    CacheControl="no-store",
                    IfNoneMatch="*",
                )
                written.append(key)
            if register:
                repository.register_certificate(settings, record, json_key, pdf_key)
        except Exception:
            # Registration is fenced by the erasure marker; remove only our writes.
            if written:
                result = client.delete_objects(
                    Bucket=settings.image_bucket,
                    Delete={
                        "Objects": [{"Key": key} for key in written],
                        "Quiet": True,
                    },
                )
                if result.get("Errors"):
                    raise HTTPException(
                        503, "Certificate cleanup is temporarily unavailable."
                    ) from None
            raise


def issue_certificate(
    settings: Settings,
    image_bytes: bytes,
    is_hot_dog: bool,
    owner_id: str | None = None,
) -> CertificateRecord:
    try:
        owner = UUID(owner_id or "")
    except ValueError as exc:
        raise HTTPException(401, "Sign in to issue a certificate.") from exc
    repository.assert_user_active(settings, owner)
    fields = {
        "schema_version": 1,
        "certificate_id": str(uuid4()),
        "issuer": "Hot Dog or Not",
        "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "image_sha256": hashlib.sha256(image_bytes).hexdigest(),
        "is_hot_dog": is_hot_dog,
        "classifier_model": settings.anthropic_model,
        "owner_id": str(owner),
    }
    record = CertificateRecord(**fields, record_sha256=record_digest(fields))
    try:
        _persist_certificate(settings, record)
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Certificate storage is temporarily unavailable."
        ) from exc
    return record


def _read_certificate(
    settings: Settings, certificate_id: UUID, key: str
) -> Certificate:
    try:
        with closing(get_s3_client(settings)) as client:
            response = client.get_object(Bucket=settings.image_bucket, Key=key)
            with closing(response["Body"]) as body:
                data = body.read(16_385)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"NoSuchKey", "404", "AccessDenied"}:
            raise HTTPException(404, "Certificate not found.") from exc
        raise HTTPException(
            503, "Certificate storage is temporarily unavailable."
        ) from exc
    except BotoCoreError as exc:
        raise HTTPException(
            503, "Certificate storage is temporarily unavailable."
        ) from exc
    try:
        if len(data) > 16_384:
            raise ValueError("Certificate record exceeds the size limit")
        fields = json.loads(data)
        record_type = (
            HumanCertificateRecord
            if fields.get("schema_version") == 2
            else CertificateRecord
        )
        record = record_type.model_validate(fields)
    except (ValidationError, ValueError, AttributeError) as exc:
        raise HTTPException(409, "Certificate metadata is invalid.") from exc
    if record.certificate_id != certificate_id:
        raise HTTPException(409, "Certificate identifier does not match its record.")
    validate_record_integrity(record)
    return record


def get_certificate(settings: Settings, certificate_id: UUID) -> Certificate:
    location = repository.get_certificate_location(settings, certificate_id)
    key = location["json_key"] if location else f"certificates/{certificate_id}.json"
    record = _read_certificate(settings, certificate_id, key)
    owner_id = _assert_record_owner_active(settings, record)
    if location and str(location["user_id"]) != str(owner_id):
        raise HTTPException(409, "Certificate owner does not match its record.")
    if isinstance(record, HumanCertificateRecord):
        completed = repository._execute(
            repository._client(settings)
            .table("hdn_reviews")
            .select("id")
            .eq("id", str(record.review_id))
            .eq("certificate_id", str(record.certificate_id))
            .eq("status", "completed")
            .limit(1)
        ).data
        if not completed:
            raise HTTPException(404, "Certificate not found.")
    return record


def stage_human_certificate(
    settings: Settings,
    original: CertificateRecord,
    review_id: UUID,
    certificate_id: UUID,
    is_hot_dog: bool,
    reviewed_at: datetime,
) -> HumanCertificateRecord:
    fields = {
        "schema_version": 2,
        "record_type": "human_review",
        "certificate_id": str(certificate_id),
        "issuer": "Hot Dog or Not",
        "issued_at": reviewed_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "image_sha256": original.image_sha256,
        "is_hot_dog": is_hot_dog,
        "classifier_model": original.classifier_model,
        "owner_id": original.owner_id,
        "original_certificate_id": str(original.certificate_id),
        "review_id": str(review_id),
        "reviewer_name": "Authorized team supervisor",
        "human_verified": True,
        "final": True,
    }
    record = HumanCertificateRecord(**fields, record_sha256=record_digest(fields))
    # Only the completion transaction publishes this staged record in the index.
    _persist_certificate(settings, record, register=False)
    return record


def signed_certificate_download(
    settings: Settings,
    certificate_id: UUID,
    requester_id: UUID | None = None,
) -> dict:
    record = get_certificate(settings, certificate_id)
    if requester_id is not None and str(requester_id) != record.owner_id:
        raise HTTPException(404, "Certificate not found.")
    location = repository.get_certificate_location(settings, certificate_id)
    try:
        if location is None:
            # Upgrade a legacy record without changing its immutable evidence.
            _persist_certificate(settings, record)
            location = repository.get_certificate_location(settings, certificate_id)
        if location is None:
            raise HTTPException(503, "Certificate download is temporarily unavailable.")
        # Render versions are separate from the immutable evidence record.
        pdf_key = f"certificates/{record.owner_id}/{certificate_id}.design-v2.pdf"
        with closing(get_s3_client(settings)) as client:
            try:
                client.head_object(Bucket=settings.image_bucket, Key=pdf_key)
            except ClientError as exc:
                if exc.response["Error"]["Code"] not in {
                    "NoSuchKey",
                    "404",
                    "NotFound",
                }:
                    raise
                verification_url = (
                    f"{str(settings.public_web_url).rstrip('/')}"
                    f"/verify/{certificate_id}"
                )
                body = render_certificate(record, verification_url)
                _assert_record_owner_active(settings, record)
                client.put_object(
                    Bucket=settings.image_bucket,
                    Key=pdf_key,
                    Body=body,
                    ContentType="application/pdf",
                    CacheControl="no-store",
                )
                # Close the erasure race; the delayed sweep also covers in-flight work.
                try:
                    _assert_record_owner_active(settings, record)
                except HTTPException:
                    client.delete_object(Bucket=settings.image_bucket, Key=pdf_key)
                    raise
            url = client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": settings.image_bucket,
                    "Key": pdf_key,
                    "ResponseContentType": "application/pdf",
                    "ResponseContentDisposition": (
                        f'attachment; filename="HDN-{certificate_id}.pdf"'
                    ),
                    "ResponseCacheControl": "private, no-store",
                },
                ExpiresIn=300,
            )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Certificate storage is temporarily unavailable."
        ) from exc
    return {"url": url, "expires_in": 300}


def public_record(record: Certificate) -> dict:
    """Expose only verification evidence; never identity or private image location."""
    validate_record_integrity(record)
    return {**record.model_dump(mode="json", exclude={"owner_id"}), "verified": True}
