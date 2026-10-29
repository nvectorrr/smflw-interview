"""Persistence, issuance, and downloads for service-issued certificates."""

import hashlib
import hmac
import io
import json
from contextlib import closing
from datetime import UTC, datetime
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
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
from smflw_api.storage import MAX_BYTES, get_s3_client


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


def _image_preview(data: bytes) -> bytes:
    """Retain a small, oriented image without the upload's location/EXIF metadata."""
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(409, "Certificate image is invalid.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 16_000_000 or max(image.size) > 8000:
                raise ValueError("Image dimensions exceed the limit")
            image = ImageOps.exif_transpose(image)
            image.thumbnail((360, 240))
            clean = Image.new("RGB", image.size, "white")
            if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
                image = image.convert("RGBA")
                clean.paste(image, mask=image.getchannel("A"))
            else:
                clean.paste(image.convert("RGB"))
            output = io.BytesIO()
            clean.save(output, format="JPEG", quality=85)
            return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise HTTPException(409, "Certificate image is invalid.") from exc


def _optional_image(settings: Settings, client, key: str) -> bytes | None:
    try:
        response = client.get_object(Bucket=settings.image_bucket, Key=key)
        with closing(response["Body"]) as body:
            data = body.read(MAX_BYTES + 1)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"NoSuchKey", "404", "NotFound"}:
            return None
        raise
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(409, "Certificate image is invalid.")
    return data


def _certificate_preview(
    settings: Settings, record: Certificate, client
) -> bytes | None:
    prefix = f"certificates/{record.owner_id}"
    preview = _optional_image(
        settings, client, f"{prefix}/{record.certificate_id}.preview.jpg"
    )
    if preview is not None:
        return preview
    original_id = record.certificate_id
    if isinstance(record, HumanCertificateRecord):
        original_id = record.original_certificate_id
        preview = _optional_image(
            settings, client, f"{prefix}/{original_id}.preview.jpg"
        )
        if preview is not None:
            return preview
    rows = repository._execute(
        repository._client(settings)
        .table("hdn_checks")
        .select("upload_id,image_key,image_sha256")
        .eq("certificate_id", str(original_id))
        .eq("user_id", record.owner_id)
        .order("created_at", desc=True)
        .limit(1)
    ).data
    if not rows:
        return None
    check = rows[0]
    try:
        key = f"uploads/{UUID(record.owner_id)}/{UUID(check['upload_id'])}"
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(409, "Certificate image metadata is invalid.") from exc
    if check["image_key"] != key or check["image_sha256"] != record.image_sha256:
        raise HTTPException(409, "Certificate image metadata is invalid.")
    data = _optional_image(settings, client, key)
    if data is None:
        return None
    if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), record.image_sha256):
        raise HTTPException(409, "Certificate image failed its integrity check.")
    return _image_preview(data)


def _reviewer_name(settings: Settings, record: HumanCertificateRecord) -> str:
    rows = repository._execute(
        repository._client(settings)
        .table("hdn_reviews")
        .select("reviewer_id")
        .eq("id", str(record.review_id))
        .eq("certificate_id", str(record.certificate_id))
        .eq("status", "completed")
        .eq("user_id", record.owner_id)
        .limit(1)
    ).data
    if not rows:
        raise HTTPException(404, "Certificate not found.")
    reviewer_id = rows[0].get("reviewer_id")
    if not reviewer_id or not repository._rpc(
        settings, "hdn_user_active", {"p_user_id": reviewer_id}
    ):
        return "Deleted account"
    # This RPC only returns name metadata; never the review API's email fallback.
    return (
        repository._rpc(settings, "hdn_review_name", {"p_user_id": reviewer_id})
        or "Team member"
    )


def _persist_certificate(
    settings: Settings,
    record: Certificate,
    *,
    register: bool = True,
    image_bytes: bytes | None = None,
    reviewer_name: str | None = None,
) -> None:
    owner_id = _assert_record_owner_active(settings, record)
    prefix = f"certificates/{owner_id}/{record.certificate_id}"
    json_key, pdf_key = f"{prefix}.json", f"{prefix}.pdf"
    verification_url = (
        f"{str(settings.public_web_url).rstrip('/')}/verify/{record.certificate_id}"
    )
    preview = _image_preview(image_bytes) if image_bytes is not None else None
    pdf = render_certificate(
        record, verification_url, image_bytes=preview, reviewer_name=reviewer_name
    )
    written = []
    with closing(get_s3_client(settings)) as client:
        try:
            assets = [
                (
                    json_key,
                    record.model_dump_json().encode("utf-8"),
                    "application/json",
                ),
                (pdf_key, pdf, "application/pdf"),
            ]
            if preview is not None:
                assets.append((f"{prefix}.preview.jpg", preview, "image/jpeg"))
            for key, body, media_type in assets:
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
        _persist_certificate(settings, record, image_bytes=image_bytes)
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
    *,
    image_bytes: bytes | None = None,
    reviewer_name: str | None = None,
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
    _persist_certificate(
        settings,
        record,
        register=False,
        image_bytes=image_bytes,
        reviewer_name=reviewer_name,
    )
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
        pdf_key = f"certificates/{record.owner_id}/{certificate_id}.design-v3.pdf"
        with closing(get_s3_client(settings)) as client:
            needs_render = isinstance(record, HumanCertificateRecord)
            try:
                client.head_object(Bucket=settings.image_bucket, Key=pdf_key)
            except ClientError as exc:
                if exc.response["Error"]["Code"] not in {
                    "NoSuchKey",
                    "404",
                    "NotFound",
                }:
                    raise
                needs_render = True
            if needs_render:
                verification_url = (
                    f"{str(settings.public_web_url).rstrip('/')}"
                    f"/verify/{certificate_id}"
                )
                preview = _certificate_preview(settings, record, client)
                reviewer = (
                    _reviewer_name(settings, record)
                    if isinstance(record, HumanCertificateRecord)
                    else None
                )
                body = render_certificate(
                    record,
                    verification_url,
                    image_bytes=preview,
                    reviewer_name=reviewer,
                )
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
                    if (
                        isinstance(record, HumanCertificateRecord)
                        and _reviewer_name(settings, record) != reviewer
                    ):
                        raise HTTPException(
                            409,
                            "Reviewer details changed. Download the certificate again.",
                        )
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
