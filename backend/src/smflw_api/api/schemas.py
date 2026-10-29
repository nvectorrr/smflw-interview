from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from smflw_api.classifier import Classification
from smflw_api.models import ModelKey
from smflw_api.storage import MAX_BYTES


class UploadRequest(BaseModel):
    content_type: Literal["image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=MAX_BYTES, strict=True)


class UploadTicket(BaseModel):
    upload_id: UUID
    url: str
    fields: dict[str, str]


class ClassificationRequest(BaseModel):
    upload_id: UUID
    model: ModelKey = "haiku"
    file_name: str = Field(default="image", min_length=1, max_length=255)
    image_name: str = Field(default="", max_length=255)


class ClassificationResult(Classification):
    certificate_id: UUID
    image_sha256: str
    issued_at: datetime
    verification_url: str
    download_url: str
    check_id: UUID
    cached: bool
    model: ModelKey
    model_id: str
    team_id: UUID | None = None


TeamRole = Literal["admin", "user", "supervisor"]


class TeamRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class InvitationRequest(BaseModel):
    role: TeamRole = "user"


class InvitationAcceptance(BaseModel):
    code: str = Field(min_length=1, max_length=100)


class RoleRequest(BaseModel):
    role: TeamRole


class ReviewDecision(BaseModel):
    is_hot_dog: bool = Field(strict=True)


class ErasureRequest(BaseModel):
    confirmation: Literal["DELETE"]
