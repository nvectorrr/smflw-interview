"""Account erasure with a delayed sweep for already-issued upload tickets."""

import json
from contextlib import closing
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from smflw_api import repository
from smflw_api.settings import Settings, get_settings
from smflw_api.storage import get_s3_client


def _delete_keys(client, bucket: str, keys: list[str]) -> None:
    for start in range(0, len(keys), 1000):
        batch = keys[start : start + 1000]
        if batch:
            result = client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
            )
            if result.get("Errors"):
                raise RuntimeError("Some account files could not be deleted.")


def cleanup_user_assets(settings: Settings, user_id: UUID) -> None:
    """Delete tracked and untracked assets; safe to repeat after account deletion."""
    with closing(get_s3_client(settings)) as client:
        # A reviewer can have named PDFs in another submitter's account.
        offset = 0
        while True:
            reviews = repository._execute(
                repository._client(settings)
                .table("hdn_reviews")
                .select("certificate_id,user_id")
                .eq("reviewer_id", str(user_id))
                .eq("status", "completed")
                .order("id")
                .range(offset, offset + 499)
            ).data
            keys = []
            for review in reviews:
                prefix = (
                    f"certificates/{UUID(review['user_id'])}/"
                    f"{UUID(review['certificate_id'])}"
                )
                keys.extend(
                    f"{prefix}{suffix}"
                    for suffix in (".pdf", ".design-v2.pdf", ".design-v3.pdf")
                )
            _delete_keys(client, settings.image_bucket, keys)
            if len(reviews) < 500:
                break
            offset += 500
        for prefix in (f"uploads/{user_id}/", f"certificates/{user_id}/"):
            pages = client.get_paginator("list_objects_v2").paginate(
                Bucket=settings.image_bucket, Prefix=prefix
            )
            for page in pages:
                _delete_keys(
                    client,
                    settings.image_bucket,
                    [item["Key"] for item in page.get("Contents", [])],
                )
        # Older certificates used global UUID filenames, with ownership in JSON.
        pages = client.get_paginator("list_objects_v2").paginate(
            Bucket=settings.image_bucket, Prefix="certificates/"
        )
        for page in pages:
            owned = []
            for item in page.get("Contents", []):
                key = item["Key"]
                if key.count("/") != 1 or not key.endswith(".json"):
                    continue
                try:
                    UUID(key.removeprefix("certificates/").removesuffix(".json"))
                except ValueError:
                    continue
                try:
                    response = client.get_object(Bucket=settings.image_bucket, Key=key)
                    with closing(response["Body"]) as body:
                        data = body.read(16_385)
                except ClientError as exc:
                    if exc.response["Error"]["Code"] in {"NoSuchKey", "404"}:
                        continue
                    raise
                if len(data) > 16_384:
                    raise RuntimeError("Legacy certificate metadata exceeds its limit.")
                metadata = json.loads(data)
                if not isinstance(metadata, dict):
                    raise ValueError("Legacy certificate metadata is invalid.")
                if metadata.get("owner_id") == str(user_id):
                    owned.extend((key, key.removesuffix(".json") + ".pdf"))
            _delete_keys(client, settings.image_bucket, owned)


def _delete_auth_user(settings: Settings, user_id: UUID, service_key: str) -> None:
    request = Request(
        f"{str(settings.supabase_url).rstrip('/')}/auth/v1/admin/users/{user_id}",
        method="DELETE",
        data=b'{"should_soft_delete":false}',
        headers={
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=10):
            pass
    except HTTPError as exc:
        if exc.code != 404:
            raise HTTPException(
                503, "Account deletion is incomplete. Please retry."
            ) from None
    except (URLError, TimeoutError, OSError):
        raise HTTPException(
            503, "Account deletion is incomplete. Please retry."
        ) from None


def erase_account(settings: Settings, user_id: UUID, confirmation: str) -> dict:
    """The caller must supply the UUID from the verified current auth session."""
    user_id = UUID(str(user_id))
    if confirmation != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm account deletion.")
    secret = settings.supabase_service_key
    service_key = secret.get_secret_value() if secret else ""
    if not service_key or not settings.cleanup_queue_url:
        raise HTTPException(503, "Account deletion is not configured.")
    try:
        # A queued catch-up must exist before any destructive work can begin.
        with closing(boto3.client("sqs", region_name=settings.aws_region)) as client:
            client.send_message(
                QueueUrl=settings.cleanup_queue_url,
                MessageBody=json.dumps({"user_id": str(user_id)}),
                DelaySeconds=360,
            )
        repository.begin_user_erasure(settings, user_id)
        cleanup_user_assets(settings, user_id)
        repository.erase_user_records(settings, user_id)
    except HTTPException:
        raise
    except (BotoCoreError, ClientError, RuntimeError, ValueError, TypeError):
        raise HTTPException(
            503, "Account deletion is incomplete. Please retry."
        ) from None
    # Keep authentication available for retries until files and app records are gone.
    _delete_auth_user(settings, user_id, service_key)
    return {"deleted": True, "cleanup_scheduled": True}


def reap_handler(event: dict, context) -> dict:
    """Finish queued erasure after API failures; failed batches remain retryable."""
    settings = get_settings()
    secret = settings.supabase_service_key
    service_key = secret.get_secret_value() if secret else ""
    if not service_key:
        raise RuntimeError("Account deletion is not configured.")
    for message in event["Records"]:
        payload = json.loads(message["body"])
        user_id = UUID(payload["user_id"])
        repository.begin_user_erasure(settings, user_id)
        cleanup_user_assets(settings, user_id)
        repository.erase_user_records(settings, user_id)
        _delete_auth_user(settings, user_id, service_key)
    return {"deleted": True}
