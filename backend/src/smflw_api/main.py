from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse
from mangum import Mangum
from pydantic import BaseModel, Field

from smflw_api import repository, reviews, teams
from smflw_api.auth import AuthUser, require_user
from smflw_api.certificates import (
    get_certificate,
    public_record,
    signed_certificate_download,
)
from smflw_api.checks import perform_check
from smflw_api.classifier import Classification
from smflw_api.models import ModelKey, get_models
from smflw_api.privacy import erase_account
from smflw_api.settings import Settings, get_settings
from smflw_api.storage import MAX_BYTES, create_upload

app = FastAPI(title="Hot dog or not API", version="0.5.0")
AppSettings = Annotated[Settings, Depends(get_settings)]
CurrentUser = Annotated[AuthUser, Depends(require_user)]


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


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/profile", response_model=AuthUser, tags=["account"])
def profile(user: CurrentUser) -> AuthUser:
    return user


@app.get("/models", tags=["photos"])
def models(settings: AppSettings):
    return get_models(settings)


@app.post("/uploads", response_model=UploadTicket, tags=["photos"])
def upload(request: UploadRequest, settings: AppSettings, user: CurrentUser):
    repository.assert_user_active(settings, user.id)
    if (
        not settings.anthropic_api_key
        or not settings.anthropic_api_key.get_secret_value()
    ):
        raise HTTPException(503, "The image detector is not configured yet.")
    return create_upload(settings, request.content_type, request.size_bytes, user.id)


@app.post("/classify", response_model=ClassificationResult, tags=["photos"])
def classify(request: ClassificationRequest, settings: AppSettings, user: CurrentUser):
    file_name = (
        request.file_name.replace("\\", "/").rsplit("/", 1)[-1].strip() or "image"
    )
    return perform_check(
        settings,
        user.id,
        request.upload_id,
        file_name,
        request.image_name.strip() or file_name,
        request.model,
    )


@app.get("/history", tags=["activity"])
def history(
    settings: AppSettings,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user_id: UUID | None = None,
    result: bool | None = None,
    verification: Literal["all", "pending", "verified", "unreviewed"] = "all",
    model: ModelKey | None = None,
):
    page = repository.get_history(
        settings,
        user.id,
        limit,
        offset,
        user_id=user_id,
        result=result,
        verification=verification,
        model=model,
    )
    reviews.attach_reviews(settings, page["items"])
    return page


@app.get("/stats", tags=["activity"])
def stats(
    settings: AppSettings,
    user: CurrentUser,
    user_id: UUID | None = None,
    result: bool | None = None,
    verification: Literal["all", "pending", "verified", "unreviewed"] = "all",
    model: ModelKey | None = None,
):
    return repository.get_stats(
        settings,
        user.id,
        user_id=user_id,
        result=result,
        verification=verification,
        model=model,
    )


@app.get("/certificates/{certificate_id}", tags=["certificates"])
def verify_certificate(certificate_id: UUID, settings: AppSettings):
    return public_record(get_certificate(settings, certificate_id))


@app.get("/certificates/{certificate_id}/download", tags=["certificates"])
def certificate_download(certificate_id: UUID, settings: AppSettings):
    return signed_certificate_download(settings, certificate_id)


@app.get("/certificates/{certificate_id}/pdf", tags=["certificates"])
def legacy_certificate_download(certificate_id: UUID, settings: AppSettings):
    signed = signed_certificate_download(settings, certificate_id)
    return RedirectResponse(
        signed["url"], status_code=307, headers={"Cache-Control": "no-store"}
    )


@app.delete("/account/data", tags=["account"])
def delete_account(request: ErasureRequest, settings: AppSettings, user: CurrentUser):
    return erase_account(settings, user.id, request.confirmation)


@app.get("/teams/current", tags=["teams"])
def current_team(settings: AppSettings, user: CurrentUser):
    return teams.current_team(settings, user.id)


@app.post("/teams", tags=["teams"])
def create_team(request: TeamRequest, settings: AppSettings, user: CurrentUser):
    return teams.create_team(settings, user.id, request.name)


@app.post("/teams/invitations", tags=["teams"])
def invite_member(request: InvitationRequest, settings: AppSettings, user: CurrentUser):
    return teams.invite_member(settings, user.id, request.role)


@app.post("/teams/invitations/accept", tags=["teams"])
def accept_invite(
    request: InvitationAcceptance, settings: AppSettings, user: CurrentUser
):
    return teams.accept_invite(settings, user.id, request.code)


@app.patch("/teams/members/{member_id}", tags=["teams"])
def change_role(
    member_id: UUID, request: RoleRequest, settings: AppSettings, user: CurrentUser
):
    return teams.change_role(settings, user.id, member_id, request.role)


@app.delete("/teams/members/{member_id}", tags=["teams"])
def remove_member(member_id: UUID, settings: AppSettings, user: CurrentUser):
    return teams.remove_member(settings, user.id, member_id)


@app.post("/checks/{check_id}/escalate", tags=["reviews"])
def escalate_check(check_id: UUID, settings: AppSettings, user: CurrentUser):
    return reviews.escalate_check(settings, user.id, check_id)


@app.get("/reviews", tags=["reviews"])
def review_queue(
    settings: AppSettings,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return reviews.review_queue(settings, user.id, limit, offset)


@app.post("/reviews/{review_id}/decision", tags=["reviews"])
def decide_review(
    review_id: UUID, request: ReviewDecision, settings: AppSettings, user: CurrentUser
):
    return reviews.decide_review(settings, user.id, review_id, request.is_hot_dog)


handler = Mangum(app, lifespan="off")
