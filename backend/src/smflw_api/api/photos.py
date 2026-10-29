from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from smflw_api import repository, reviews
from smflw_api.api.dependencies import AppSettings, CurrentUser
from smflw_api.api.schemas import (
    ClassificationRequest,
    ClassificationResult,
    UploadRequest,
    UploadTicket,
)
from smflw_api.certificates import (
    get_certificate,
    public_record,
    signed_certificate_download,
)
from smflw_api.checks import perform_check
from smflw_api.models import ModelKey, get_models
from smflw_api.storage import create_upload

router = APIRouter()


@router.get("/models", tags=["photos"])
def models(settings: AppSettings):
    return get_models(settings)


@router.post("/uploads", response_model=UploadTicket, tags=["photos"])
def upload(request: UploadRequest, settings: AppSettings, user: CurrentUser):
    repository.assert_user_active(settings, user.id)
    if (
        not settings.anthropic_api_key
        or not settings.anthropic_api_key.get_secret_value()
    ):
        raise HTTPException(503, "The image detector is not configured yet.")
    return create_upload(settings, request.content_type, request.size_bytes, user.id)


@router.post("/classify", response_model=ClassificationResult, tags=["photos"])
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


@router.get("/history", tags=["activity"])
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


@router.get("/stats", tags=["activity"])
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


@router.get("/certificates/{certificate_id}", tags=["certificates"])
def verify_certificate(certificate_id: UUID, settings: AppSettings):
    return public_record(get_certificate(settings, certificate_id))


@router.get("/certificates/{certificate_id}/download", tags=["certificates"])
def certificate_download(certificate_id: UUID, settings: AppSettings):
    return signed_certificate_download(settings, certificate_id)


@router.get("/certificates/{certificate_id}/pdf", tags=["certificates"])
def legacy_certificate_download(certificate_id: UUID, settings: AppSettings):
    signed = signed_certificate_download(settings, certificate_id)
    return RedirectResponse(
        signed["url"], status_code=307, headers={"Cache-Control": "no-store"}
    )
