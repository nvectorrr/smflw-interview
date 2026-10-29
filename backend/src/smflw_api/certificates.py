"""Persistent service-issued classification records and their PDF representation."""

import hashlib
import hmac
import io
import json
from contextlib import closing
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from smflw_api import repository
from smflw_api.settings import Settings
from smflw_api.storage import get_s3_client


class CertificateRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal[1] = 1
    certificate_id: UUID
    issuer: Literal["Hot Dog or Not"] = "Hot Dog or Not"
    issued_at: datetime
    image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    is_hot_dog: bool = Field(strict=True)
    classifier_model: str = Field(min_length=1, max_length=200)
    owner_id: str | None = None
    record_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("issued_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Certificate issue time requires a timezone")
        return value.astimezone(UTC)


class HumanCertificateRecord(CertificateRecord):
    schema_version: Literal[2] = 2
    record_type: Literal["human_review"] = "human_review"
    original_certificate_id: UUID
    review_id: UUID
    reviewer_name: Literal["Authorized team supervisor"] = "Authorized team supervisor"
    human_verified: Literal[True] = True
    final: Literal[True] = True


Certificate = CertificateRecord | HumanCertificateRecord


def _digest(fields: dict) -> str:
    canonical = json.dumps(
        fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_integrity(record: Certificate) -> None:
    expected = _digest(record.model_dump(mode="json", exclude={"record_sha256"}))
    if not hmac.compare_digest(expected, record.record_sha256):
        raise HTTPException(409, "Certificate metadata failed its integrity check.")


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
    record = CertificateRecord(**fields, record_sha256=_digest(fields))
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
    _validate_integrity(record)
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
    record = HumanCertificateRecord(**fields, record_sha256=_digest(fields))
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
    _validate_integrity(record)
    return {**record.model_dump(mode="json", exclude={"owner_id"}), "verified": True}


def render_certificate(record: Certificate, verification_url: str) -> bytes:
    """One-page operational record with a restrained, typographic hierarchy."""
    _validate_integrity(record)
    human = isinstance(record, HumanCertificateRecord)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(f"Verification record / {record.certificate_id}")
    pdf.setAuthor(record.issuer)
    pdf.setSubject(
        "Final human verification" if human else "Automated visual assessment"
    )
    width, _ = A4
    left, right = 42, width - 42
    ink = colors.HexColor("#1B1C1E")
    gray = colors.HexColor("#606268")
    line = colors.HexColor("#CFD0D2")

    def text(x, y, value, size=9, font="Helvetica", color=ink):
        pdf.setFillColor(color)
        pdf.setFont(font, size)
        pdf.drawString(x, y, value)

    def rule(y):
        pdf.setStrokeColor(line)
        pdf.setLineWidth(0.55)
        pdf.line(left, y, right, y)

    def label(x, y, value):
        text(x, y, value, 7, "Helvetica-Bold", gray)

    def fitted(x, y, value, max_width, size=9, font="Courier", color=ink):
        # Long references retain every character while respecting their column.
        size = min(size, max_width / max(pdf.stringWidth(value, font, 1), 1))
        text(x, y, value, size, font, color)

    text(left, 790, "HD / NOT", 19, "Helvetica-Bold")
    label(right - 145, 796, "VISUAL INTELLIGENCE / RECORDS")
    text(right - 145, 781, "HUMAN REVIEW" if human else "MODEL ASSESSMENT", 8)
    rule(763)
    label(left, 736, "CERTIFICATE / 02" if human else "CERTIFICATE / 01")
    text(left, 688, "Human verification." if human else "Visual assessment.", 38)
    text(
        left,
        663,
        "Final determination by an authorized team supervisor."
        if human
        else "Recorded determination from automated image analysis.",
        10,
        color=gray,
    )
    fitted(left, 643, str(record.certificate_id), right - left, 9)

    pdf.setFillColor(ink)
    pdf.rect(left, 528, right - left, 94, fill=1, stroke=0)
    text(
        left + 18,
        602,
        "01 / FINAL HUMAN VERDICT" if human else "01 / MODEL VERDICT",
        7,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        561,
        "HOT DOG" if record.is_hot_dog else "NOT HOT DOG",
        33,
        "Helvetica-Bold",
        colors.white,
    )
    text(
        left + 18,
        542,
        f"is_hot_dog = {str(record.is_hot_dog).lower()}",
        8,
        "Courier",
        colors.HexColor("#CFD0D2"),
    )

    label(left, 505, "02 / ASSESSMENT METADATA")
    label(left, 484, "ISSUED / UTC")
    text(left, 468, record.issued_at.strftime("%Y-%m-%d  %H:%M:%S UTC"), 9, "Courier")
    label(left + 260, 484, "ORIGINAL CLASSIFIER")
    # Wrap even long custom model identifiers without dropping evidence.
    model_lines = []
    current = ""
    for character in record.classifier_model:
        if pdf.stringWidth(current + character, "Courier", 7) > right - left - 260:
            model_lines.append(current)
            current = ""
        current += character
    model_lines.append(current)
    for index, value in enumerate(model_lines):
        text(left + 260, 470 - index * 8, value, 7, "Courier")
    rule(434)
    label(left, 415, "03 / ORIGINAL IMAGE FINGERPRINT")
    text(left, 397, "SHA-256 / exact uploaded bytes", 8, color=gray)
    text(left, 377, record.image_sha256[:32], 11, "Courier")
    text(left, 362, record.image_sha256[32:], 11, "Courier")
    rule(347)

    label(left, 327, "04 / EVIDENCE CHAIN")
    if human:
        label(left, 307, "ORIGINAL CERTIFICATE")
        text(left, 292, str(record.original_certificate_id), 9, "Courier")
        label(left, 273, "REVIEW REFERENCE")
        text(left, 258, str(record.review_id), 9, "Courier")
    else:
        text(
            left, 306, "The file fingerprint binds this verdict to one exact image.", 9
        )
        text(
            left,
            289,
            "Verification compares the stored record and its integrity hash.",
            9,
        )
        text(
            left,
            272,
            "The recorded model verdict remains part of the evidence chain.",
            9,
        )
    rule(242)

    qr = QrCodeWidget(verification_url, barLevel="M")
    x0, y0, x1, y1 = qr.getBounds()
    qr_size = 88
    drawing = Drawing(
        qr_size,
        qr_size,
        transform=[qr_size / (x1 - x0), 0, 0, qr_size / (y1 - y0), 0, 0],
    )
    drawing.add(qr)
    renderPDF.draw(drawing, pdf, left - 5, 143)
    label(left + 104, 221, "05 / SERVICE VERIFICATION")
    text(left + 104, 201, "Scan to inspect the authoritative record.", 10)
    text(
        left + 104,
        183,
        "Compare your file against the recorded image fingerprint.",
        8,
        color=gray,
    )
    fitted(left + 104, 164, verification_url, right - left - 104, 7, "Helvetica")
    pdf.linkURL(verification_url, (left, 143, right, 231), relative=0, thickness=0)
    label(left, 128, "RECORD INTEGRITY / SHA-256")
    fitted(left, 113, record.record_sha256, right - left, 8)
    rule(99)
    text(
        left,
        82,
        "HUMAN VERIFIED. FINAL AND NOT SUBJECT TO APPEAL WITHIN THIS SERVICE."
        if human
        else "AUTOMATED ASSESSMENT. THE MODEL RESULT MAY BE INCORRECT.",
        7.5,
        "Helvetica-Bold",
    )
    text(
        left,
        67,
        "Service-issued evidence; no external accreditation. "
        "This PDF is not digitally signed.",
        7.5,
        color=gray,
    )
    rule(51)
    label(left, 34, "HOT DOG OR NOT / VERIFICATION OFFICE")
    label(right - 50, 34, "01 / 01")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
