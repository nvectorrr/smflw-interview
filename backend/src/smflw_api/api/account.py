from fastapi import APIRouter

from smflw_api.api.dependencies import AppSettings, CurrentUser
from smflw_api.api.schemas import ErasureRequest
from smflw_api.auth import AuthUser
from smflw_api.privacy import erase_account

router = APIRouter()


@router.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/profile", response_model=AuthUser, tags=["account"])
def profile(user: CurrentUser) -> AuthUser:
    return user


@router.delete("/account/data", tags=["account"])
def delete_account(request: ErasureRequest, settings: AppSettings, user: CurrentUser):
    return erase_account(settings, user.id, request.confirmation)
