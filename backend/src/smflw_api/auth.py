import json
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ValidationError

from smflw_api.settings import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


class AuthUser(BaseModel):
    id: UUID
    email: str | None = None
    display_name: str | None = None


def require_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthUser:
    if credentials is None:
        raise HTTPException(
            401,
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Supabase verifies the access token; no unverified JWT claims are trusted.
    request = Request(
        f"{str(settings.supabase_url).rstrip('/')}/auth/v1/user",
        headers={
            "Authorization": f"Bearer {credentials.credentials}",
            "apikey": settings.supabase_publishable_key.get_secret_value(),
        },
    )
    try:
        with urlopen(request, timeout=10) as response:
            data = json.load(response)
        metadata = data.get("user_metadata") or {}
        name = metadata.get("display_name")
        return AuthUser(
            id=data["id"],
            email=data.get("email"),
            display_name=name if isinstance(name, str) else None,
        )
    except HTTPError as error:
        if error.code in (401, 403):
            raise HTTPException(
                401,
                "Your session expired. Please sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from None
        raise HTTPException(
            503, "The sign-in service is temporarily unavailable."
        ) from None
    except (URLError, TimeoutError, OSError):
        raise HTTPException(
            503, "The sign-in service is temporarily unavailable."
        ) from None
    except (ValueError, KeyError, TypeError, AttributeError, ValidationError):
        raise HTTPException(
            503, "The sign-in service returned an invalid response."
        ) from None
