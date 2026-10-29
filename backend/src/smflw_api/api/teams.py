from uuid import UUID

from fastapi import APIRouter, Query

from smflw_api import reviews, teams
from smflw_api.api.dependencies import AppSettings, CurrentUser
from smflw_api.api.schemas import (
    InvitationAcceptance,
    InvitationRequest,
    ReviewDecision,
    RoleRequest,
    TeamRequest,
)

router = APIRouter()


@router.get("/teams/current", tags=["teams"])
def current_team(settings: AppSettings, user: CurrentUser):
    return teams.current_team(settings, user.id)


@router.post("/teams", tags=["teams"])
def create_team(request: TeamRequest, settings: AppSettings, user: CurrentUser):
    return teams.create_team(settings, user.id, request.name)


@router.post("/teams/invitations", tags=["teams"])
def invite_member(request: InvitationRequest, settings: AppSettings, user: CurrentUser):
    return teams.invite_member(settings, user.id, request.role)


@router.post("/teams/invitations/accept", tags=["teams"])
def accept_invite(
    request: InvitationAcceptance, settings: AppSettings, user: CurrentUser
):
    return teams.accept_invite(settings, user.id, request.code)


@router.patch("/teams/members/{member_id}", tags=["teams"])
def change_role(
    member_id: UUID, request: RoleRequest, settings: AppSettings, user: CurrentUser
):
    return teams.change_role(settings, user.id, member_id, request.role)


@router.delete("/teams/members/{member_id}", tags=["teams"])
def remove_member(member_id: UUID, settings: AppSettings, user: CurrentUser):
    return teams.remove_member(settings, user.id, member_id)


@router.post("/checks/{check_id}/escalate", tags=["reviews"])
def escalate_check(check_id: UUID, settings: AppSettings, user: CurrentUser):
    return reviews.escalate_check(settings, user.id, check_id)


@router.get("/reviews", tags=["reviews"])
def review_queue(
    settings: AppSettings,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    submitter_id: UUID | None = None,
):
    return reviews.review_queue(settings, user.id, limit, offset, submitter_id)


@router.post("/reviews/{review_id}/decision", tags=["reviews"])
def decide_review(
    review_id: UUID, request: ReviewDecision, settings: AppSettings, user: CurrentUser
):
    return reviews.decide_review(settings, user.id, review_id, request.is_hot_dog)
