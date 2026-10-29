"""Team membership and short-lived invitation codes, available only through the API."""

import hashlib
import secrets
from typing import Literal
from uuid import UUID

from fastapi import HTTPException

from smflw_api import repository
from smflw_api.settings import Settings

Role = Literal["admin", "user", "supervisor"]


def _call(settings: Settings, name: str, **params) -> dict:
    result = repository._rpc(settings, name, params)
    if error := result.get("error"):
        status, message = {
            "inactive": (409, "This account is being deleted or no longer exists."),
            "already_member": (409, "This account already belongs to a team."),
            "forbidden": (403, "Only a team administrator can make this change."),
            "invalid": (400, "Check the team name, email address, or role."),
            "invalid_invite": (
                400,
                "This invitation code is invalid, expired, or already used.",
            ),
            "rate_limited": (429, "Too many attempts. Try again in 10 minutes."),
            "missing_member": (404, "This team member no longer exists."),
            "last_admin": (409, "The team must keep at least one administrator."),
        }.get(error, (409, "The team changed. Please refresh and try again."))
        raise HTTPException(status, message)
    return result


def current_team(settings: Settings, user_id: UUID) -> dict:
    repository.assert_user_active(settings, user_id)
    return _call(settings, "hdn_team_context", p_user_id=str(user_id))


def create_team(settings: Settings, user_id: UUID, name: str) -> dict:
    name = name.strip()
    if not 1 <= len(name) <= 80:
        raise HTTPException(400, "Use a team name between 1 and 80 characters.")
    return _call(settings, "hdn_create_team", p_user_id=str(user_id), p_name=name)


def invite_member(settings: Settings, user_id: UUID, role: Role) -> dict:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(5):
        code = "".join(secrets.choice(alphabet) for _ in range(7))
        result = repository._rpc(
            settings,
            "hdn_create_invite_code",
            {
                "p_user_id": str(user_id),
                "p_role": role,
                "p_code_hash": hashlib.sha256(code.encode()).hexdigest(),
            },
        )
        if result.get("error") == "collision":
            continue
        if result.get("error"):
            # Reuse the common error mapping without repeating a mutation.
            error = result["error"]
            if error == "inactive":
                raise HTTPException(409, "This account is being deleted.")
            if error == "forbidden":
                raise HTTPException(
                    403, "Only a team administrator can invite members."
                )
            raise HTTPException(400, "Choose a valid member role.")
        return {**result, "code": code}
    raise HTTPException(503, "Could not generate a code. Please try again.")


def accept_invite(settings: Settings, user_id: UUID, code: str) -> dict:
    normalized = code.strip().upper()
    return _call(
        settings,
        "hdn_accept_invite_code",
        p_user_id=str(user_id),
        p_code_hash=hashlib.sha256(normalized.encode()).hexdigest(),
    )


def change_role(settings: Settings, user_id: UUID, member_id: UUID, role: Role) -> dict:
    return _call(
        settings,
        "hdn_change_role",
        p_user_id=str(user_id),
        p_member_id=str(member_id),
        p_role=role,
    )


def remove_member(settings: Settings, user_id: UUID, member_id: UUID) -> dict:
    return _call(
        settings,
        "hdn_remove_member",
        p_user_id=str(user_id),
        p_member_id=str(member_id),
    )
