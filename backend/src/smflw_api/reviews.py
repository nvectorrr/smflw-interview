"""Team-scoped second-human reviews; model verdicts are never overwritten."""

import hashlib
import hmac
import logging
from contextlib import closing
from datetime import UTC, datetime
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from smflw_api import repository
from smflw_api.certificates import get_certificate, stage_human_certificate
from smflw_api.settings import Settings
from smflw_api.storage import MAX_BYTES, get_s3_client, read_image

logger = logging.getLogger(__name__)


def _result(value: dict) -> dict:
    error = value.get("error")
    if not error:
        return value
    if error == "not_found":
        raise HTTPException(404, "Review or check not found.")
    if error == "team_required":
        raise HTTPException(409, "Join the check's team to request a human review.")
    if error == "inactive":
        raise HTTPException(409, "An account involved in this review is being deleted.")
    if error == "completed":
        raise HTTPException(
            409, "This human determination is final and cannot be changed."
        )
    raise HTTPException(
        409, "This review is being processed or has expired. Refresh and try again."
    )


def _snapshot_key(owner_id: str, review_id: str) -> str:
    return f"certificates/{UUID(str(owner_id))}/review-images/{UUID(str(review_id))}"


def _delete_assets(settings: Settings, keys: list[str]) -> None:
    try:
        with closing(get_s3_client(settings)) as client:
            response = client.delete_objects(
                Bucket=settings.image_bucket,
                Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
            )
            if response.get("Errors"):
                logger.warning("Review asset cleanup will require an account sweep.")
    except (BotoCoreError, ClientError):
        logger.warning("Review asset cleanup is temporarily unavailable.")


def escalate_check(settings: Settings, user_id: UUID, check_id: UUID) -> dict:
    repository.assert_user_active(settings, user_id)
    rows = repository._execute(
        repository._client(settings)
        .table("hdn_checks")
        .select("*")
        .eq("id", str(check_id))
        .eq("user_id", str(user_id))
        .limit(1)
    ).data
    if not rows:
        raise HTTPException(404, "Check not found.")
    check = rows[0]
    if not check.get("team_id"):
        raise HTTPException(409, "Only checks made in a team can be escalated.")
    existing = repository._execute(
        repository._client(settings)
        .table("hdn_reviews")
        .select("id")
        .eq("check_id", str(check_id))
        .limit(1)
    ).data
    if existing:
        return repository._rpc(
            settings, "hdn_review_result", {"p_review_id": existing[0]["id"]}
        )
    expected_key = f"uploads/{user_id}/{UUID(str(check['upload_id']))}"
    if check["image_key"] != expected_key:
        raise HTTPException(409, "The original image metadata is invalid.")
    try:
        data, content_type = read_image(settings, UUID(check["upload_id"]), user_id)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(
                410, "Original image has expired. Upload it again to request review."
            ) from exc
        raise
    if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), check["image_sha256"]):
        raise HTTPException(409, "The original image no longer matches this check.")
    review_id = uuid4()
    key = _snapshot_key(str(user_id), str(review_id))
    try:
        with closing(get_s3_client(settings)) as client:
            client.put_object(
                Bucket=settings.image_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl="no-store",
                IfNoneMatch="*",
            )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Review image storage is temporarily unavailable."
        ) from exc
    # A review retains only its own original image until the final determination.
    # Keep the snapshot on an unknown commit outcome; it may back a live review.
    # Its owner-scoped prefix is included in account-erasure sweeps.
    result = repository._rpc(
        settings,
        "hdn_escalate_check",
        {
            "p_user_id": str(user_id),
            "p_check_id": str(check_id),
            "p_review_id": str(review_id),
            "p_image_key": key,
        },
    )
    if result.get("error") or result.get("id") != str(review_id):
        _delete_assets(settings, [key])
    return _result(result)


def review_queue(
    settings: Settings,
    user_id: UUID,
    limit: int = 20,
    offset: int = 0,
    submitter_id: UUID | None = None,
) -> dict:
    repository.assert_user_active(settings, user_id)
    page = repository._rpc(
        settings,
        "hdn_review_queue",
        {
            "p_user_id": str(user_id),
            "p_limit": max(1, min(limit, 100)),
            "p_offset": max(0, offset),
            "p_submitter_id": str(submitter_id) if submitter_id else None,
        },
    )
    try:
        with closing(get_s3_client(settings)) as client:
            for item in page["items"]:
                key = item.pop("image_key")
                if key != _snapshot_key(item["user_id"], item["id"]):
                    raise HTTPException(409, "Review image metadata is invalid.")
                item["image_url"] = client.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": settings.image_bucket,
                        "Key": key,
                        "ResponseCacheControl": "private, no-store",
                    },
                    ExpiresIn=300,
                )
                item["image_url_expires_in"] = 300
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Review image storage is temporarily unavailable."
        ) from exc
    return page


def decide_review(
    settings: Settings, user_id: UUID, review_id: UUID, is_hot_dog: bool
) -> dict:
    if type(is_hot_dog) is not bool:
        raise HTTPException(422, "A boolean human verdict is required.")
    claim = _result(
        repository._rpc(
            settings,
            "hdn_claim_review",
            {
                "p_user_id": str(user_id),
                "p_review_id": str(review_id),
            },
        )
    )
    certificate_id = uuid4()
    owner_id = UUID(claim["user_id"])
    key = _snapshot_key(str(owner_id), str(review_id))
    try:
        if claim["image_key"] != key:
            raise HTTPException(409, "Review image metadata is invalid.")
        rows = repository._execute(
            repository._client(settings)
            .table("hdn_checks")
            .select("*")
            .eq("id", claim["check_id"])
            .eq("user_id", str(owner_id))
            .eq("team_id", claim["team_id"])
            .limit(1)
        ).data
        if not rows:
            raise HTTPException(404, "The original check no longer exists.")
        check = rows[0]
        with closing(get_s3_client(settings)) as client:
            response = client.get_object(Bucket=settings.image_bucket, Key=key)
            with closing(response["Body"]) as body:
                data = body.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES or len(data) != check["size_bytes"]:
            raise HTTPException(409, "The review image is invalid.")
        actual_hash = hashlib.sha256(data).hexdigest()
        original = get_certificate(settings, UUID(check["certificate_id"]))
        if (
            original.schema_version != 1
            or original.owner_id != str(owner_id)
            or original.classifier_model != check["model_id"]
            or original.is_hot_dog != check["is_hot_dog"]
            or not hmac.compare_digest(actual_hash, check["image_sha256"])
            or not hmac.compare_digest(actual_hash, original.image_sha256)
        ):
            raise HTTPException(
                409, "The original evidence failed its integrity check."
            )
        repository.assert_user_active(settings, user_id)
        reviewed_at = datetime.now(UTC)
        stage_human_certificate(
            settings,
            original,
            review_id,
            certificate_id,
            is_hot_dog,
            reviewed_at,
            image_bytes=data,
            reviewer_name=repository._rpc(
                settings, "hdn_review_name", {"p_user_id": str(user_id)}
            )
            or "Team member",
        )
        try:
            repository.assert_user_active(settings, user_id)
        except HTTPException:
            prefix = f"certificates/{owner_id}/{certificate_id}"
            _delete_assets(
                settings, [f"{prefix}.json", f"{prefix}.pdf", f"{prefix}.preview.jpg"]
            )
            raise
        result = repository._rpc(
            settings,
            "hdn_complete_review",
            {
                "p_user_id": str(user_id),
                "p_review_id": str(review_id),
                "p_lease_id": claim["lease_id"],
                "p_certificate_id": str(certificate_id),
                "p_is_hot_dog": is_hot_dog,
                "p_reviewed_at": reviewed_at.isoformat(),
            },
        )
        if result.get("error"):
            prefix = f"certificates/{owner_id}/{certificate_id}"
            _delete_assets(
                settings, [f"{prefix}.json", f"{prefix}.pdf", f"{prefix}.preview.jpg"]
            )
        completed = _result(result)
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            503, "Review image storage is temporarily unavailable."
        ) from exc
    finally:
        # A failed/unknown transaction never publishes a provisional certificate.
        # Do not delete staged files on unknown commit outcomes; the index gates reads.
        try:
            repository._rpc(
                settings,
                "hdn_release_review",
                {
                    "p_review_id": str(review_id),
                    "p_lease_id": claim["lease_id"],
                },
            )
        except HTTPException:
            logger.warning("Review lease release failed; the lease will expire.")
    _delete_assets(settings, [key])
    return completed


def attach_reviews(settings: Settings, items: list[dict]) -> list[dict]:
    if not items:
        return items
    results = repository._rpc(
        settings,
        "hdn_reviews_for_checks",
        {"p_check_ids": [item["id"] for item in items]},
    )
    by_check = {review["check_id"]: review for review in results}
    for item in items:
        item["review"] = by_check.get(item["id"])
    return items
