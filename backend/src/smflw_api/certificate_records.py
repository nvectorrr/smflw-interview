"""Immutable classification evidence and its canonical integrity hash."""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


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


def record_digest(fields: dict) -> str:
    canonical = json.dumps(
        fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_record_integrity(record: Certificate) -> None:
    expected = record_digest(record.model_dump(mode="json", exclude={"record_sha256"}))
    if not hmac.compare_digest(expected, record.record_sha256):
        raise HTTPException(409, "Certificate metadata failed its integrity check.")
