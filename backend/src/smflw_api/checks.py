"""Classify exact image bytes once per user/model and record every completed check."""

import hashlib
import logging
from uuid import UUID

from smflw_api import repository
from smflw_api.certificates import get_certificate, issue_certificate
from smflw_api.classifier import infer_image
from smflw_api.models import resolve_model
from smflw_api.settings import Settings
from smflw_api.storage import read_image

logger = logging.getLogger(__name__)


def perform_check(
    settings: Settings,
    user_id: UUID,
    upload_id: UUID,
    file_name: str,
    image_name: str,
    model: str,
) -> dict:
    selected_settings, model_id = resolve_model(settings, model)
    data, content_type = read_image(settings, upload_id, user_id)
    image_sha256 = hashlib.sha256(data).hexdigest()
    metadata = {
        "upload_id": str(upload_id),
        "file_name": file_name,
        "image_name": image_name,
        "image_key": f"uploads/{user_id}/{upload_id}",
        "size_bytes": len(data),
        "content_type": content_type,
    }
    claim = repository.claim_check(
        settings, user_id, image_sha256, model, model_id, metadata
    )
    cached = claim["status"] == "cached"
    if cached:
        record = get_certificate(settings, UUID(claim["certificate_id"]))
        check_id = claim["check_id"]
    else:
        try:
            inference = infer_image(selected_settings, data, content_type)
            record = issue_certificate(
                selected_settings,
                data,
                inference.classification.is_hot_dog,
                str(user_id),
            )
            completed = repository.complete_check(
                settings,
                user_id,
                image_sha256,
                model,
                model_id,
                claim["lease_id"],
                str(record.certificate_id),
                record.is_hot_dog,
                metadata,
                inference.input_tokens,
                inference.output_tokens,
            )
            check_id = completed["check_id"]
        except Exception:
            try:
                repository.release_check(
                    settings, user_id, image_sha256, model_id, claim["lease_id"]
                )
            except Exception:
                logger.warning(
                    "Could not release a classification lease; it will expire."
                )
            raise
    public_url = str(settings.public_web_url).rstrip("/")
    return {
        "is_hot_dog": record.is_hot_dog,
        "certificate_id": record.certificate_id,
        "image_sha256": image_sha256,
        "issued_at": record.issued_at,
        "verification_url": f"{public_url}/verify/{record.certificate_id}",
        "download_url": f"/certificates/{record.certificate_id}/download",
        "check_id": check_id,
        "team_id": claim.get("team_id"),
        "cached": cached,
        "model": model,
        "model_id": model_id,
    }
