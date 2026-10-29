"""Server-only persistence; callers supply authenticated user identifiers."""

from uuid import UUID

from fastapi import HTTPException

from smflw_api.settings import Settings
from supabase import create_client


def _client(settings: Settings):
    key = settings.supabase_service_key
    if not key or not key.get_secret_value():
        raise HTTPException(503, "Account history storage is not configured yet.")
    return create_client(str(settings.supabase_url), key.get_secret_value())


def _execute(query):
    try:
        return query.execute()
    except Exception as exc:
        # Do not expose database details or server credentials to API clients.
        raise HTTPException(503, "Account storage is temporarily unavailable.") from exc


def _rpc(settings: Settings, name: str, params: dict):
    return _execute(_client(settings).rpc(name, params)).data


def assert_user_active(settings: Settings, user_id: UUID | str) -> None:
    if not _rpc(settings, "hdn_user_active", {"p_user_id": str(user_id)}):
        raise HTTPException(409, "This account is being deleted or no longer exists.")


def begin_user_erasure(settings: Settings, user_id: UUID | str) -> None:
    _rpc(settings, "hdn_begin_user_erasure", {"p_user_id": str(user_id)})


def claim_check(
    settings: Settings,
    user_id: UUID,
    image_sha256: str,
    model: str,
    model_id: str,
    metadata: dict,
) -> dict:
    result = _rpc(
        settings,
        "hdn_claim_check",
        {
            "p_user_id": str(user_id),
            "p_image_sha256": image_sha256,
            "p_model": model,
            "p_model_id": model_id,
            "p_metadata": metadata,
        },
    )
    if result["status"] == "inactive":
        raise HTTPException(409, "This account is being deleted or no longer exists.")
    if result["status"] == "busy":
        raise HTTPException(
            409,
            "This image is already being checked with this model. Try again shortly.",
            headers={"Retry-After": "3"},
        )
    return result


def complete_check(
    settings: Settings,
    user_id: UUID,
    image_sha256: str,
    model: str,
    model_id: str,
    lease_id: str,
    certificate_id: str,
    is_hot_dog: bool,
    metadata: dict,
    input_tokens: int,
    output_tokens: int,
) -> dict:
    result = _rpc(
        settings,
        "hdn_complete_check",
        {
            "p_user_id": str(user_id),
            "p_image_sha256": image_sha256,
            "p_model": model,
            "p_model_id": model_id,
            "p_lease_id": lease_id,
            "p_certificate_id": certificate_id,
            "p_is_hot_dog": is_hot_dog,
            "p_metadata": metadata,
            "p_input_tokens": input_tokens,
            "p_output_tokens": output_tokens,
        },
    )
    if result["status"] != "completed":
        raise HTTPException(
            409, "This check expired or the account is being deleted. Please try again."
        )
    return result


def release_check(
    settings: Settings, user_id: UUID, image_sha256: str, model_id: str, lease_id: str
) -> None:
    _rpc(
        settings,
        "hdn_release_check",
        {
            "p_user_id": str(user_id),
            "p_image_sha256": image_sha256,
            "p_model_id": model_id,
            "p_lease_id": lease_id,
        },
    )


def _activity_filters(user_id=None, result=None, verification="all", model=None):
    return {
        "p_filter_user": str(user_id) if user_id else None,
        "p_result": result,
        "p_verification": verification,
        "p_model": model,
    }


def get_history(
    settings: Settings, actor_id: UUID, limit: int = 20, offset: int = 0, **filters
) -> dict:
    assert_user_active(settings, actor_id)
    return _rpc(
        settings,
        "hdn_filtered_history",
        {
            "p_user_id": str(actor_id),
            "p_limit": limit,
            "p_offset": offset,
            **_activity_filters(**filters),
        },
    )


def get_stats(settings: Settings, actor_id: UUID, **filters) -> dict:
    assert_user_active(settings, actor_id)
    return _rpc(
        settings,
        "hdn_filtered_stats",
        {
            "p_user_id": str(actor_id),
            **_activity_filters(**filters),
        },
    )


def get_certificate_location(
    settings: Settings, certificate_id: UUID | str
) -> dict | None:
    response = _execute(
        _client(settings)
        .table("hdn_certificates")
        .select("user_id,json_key,pdf_key")
        .eq("certificate_id", str(certificate_id))
        .limit(1)
    )
    return response.data[0] if response.data else None


def register_certificate(
    settings: Settings, record, json_key: str, pdf_key: str
) -> None:
    result = _rpc(
        settings,
        "hdn_register_certificate",
        {
            "p_user_id": str(record.owner_id),
            "p_certificate_id": str(record.certificate_id),
            "p_json_key": json_key,
            "p_pdf_key": pdf_key,
            "p_created_at": record.issued_at.isoformat(),
        },
    )
    if not result:
        raise HTTPException(409, "This account is being deleted or no longer exists.")


def get_user_certificate_locations(
    settings: Settings, user_id: UUID | str
) -> list[dict]:
    # Page explicitly: PostgREST otherwise truncates large accounts at its row limit.
    result = []
    offset = 0
    while True:
        rows = _execute(
            _client(settings)
            .table("hdn_certificates")
            .select("certificate_id,user_id,json_key,pdf_key")
            .eq("user_id", str(user_id))
            .order("certificate_id")
            .range(offset, offset + 499)
        ).data
        result.extend(rows)
        if len(rows) < 500:
            return result
        offset += 500


def erase_user_records(settings: Settings, user_id: UUID | str) -> None:
    _rpc(settings, "hdn_erase_user_records", {"p_user_id": str(user_id)})
