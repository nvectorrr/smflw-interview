"""Trust-boundary checks without network or infrastructure."""

from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from smflw_api import certificates, reviews
from smflw_api.auth import AuthUser, require_user
from smflw_api.certificate_records import (
    CertificateRecord,
    record_digest,
    validate_record_integrity,
)
from smflw_api.main import app
from smflw_api.settings import get_settings


def test_v1_integrity_and_human_staging_preserve_original():
    fields = {
        "schema_version": 1,
        "certificate_id": str(uuid4()),
        "issuer": "Hot Dog or Not",
        "issued_at": "2026-10-29T21:00:00Z",
        "image_sha256": "a" * 64,
        "is_hot_dog": True,
        "classifier_model": "original-model",
        "owner_id": str(uuid4()),
    }
    original = CertificateRecord(**fields, record_sha256=record_digest(fields))
    before = original.model_dump_json()
    validate_record_integrity(original)
    with patch.object(certificates, "_persist_certificate") as persist:
        human = certificates.stage_human_certificate(
            None, original, uuid4(), uuid4(), False, datetime.now(UTC)
        )
    persist.assert_called_once_with(
        None, human, register=False, image_bytes=None, reviewer_name=None
    )
    assert original.model_dump_json() == before
    assert human.schema_version == 2
    assert human.original_certificate_id == original.certificate_id
    assert human.is_hot_dog is False
    public = certificates.public_record(human)
    assert not {"owner_id", "reviewer_id", "reviewer_email"} & public.keys()
    assert public["reviewer_name"] == "Authorized team supervisor"
    validate_record_integrity(human)


@pytest.mark.parametrize("verdict", [1, 0, "true", None])
def test_review_verdict_must_be_an_actual_boolean(verdict):
    with patch.object(reviews.repository, "_rpc") as rpc:
        with pytest.raises(HTTPException) as error:
            reviews.decide_review(None, uuid4(), uuid4(), verdict)
    assert error.value.status_code == 422
    rpc.assert_not_called()


def test_denied_reviewer_never_stages_a_certificate():
    with patch.object(reviews.repository, "_rpc", return_value={"error": "not_found"}):
        with patch.object(reviews, "stage_human_certificate") as stage:
            with pytest.raises(HTTPException) as error:
                reviews.decide_review(None, uuid4(), uuid4(), False)
    assert error.value.status_code == 404
    stage.assert_not_called()


@pytest.fixture
def review_client():
    actor = uuid4()
    app.dependency_overrides[get_settings] = lambda: None
    app.dependency_overrides[require_user] = lambda: AuthUser(id=actor)
    try:
        yield TestClient(app), actor
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(require_user, None)


@pytest.mark.parametrize("filtered", [False, True])
def test_review_queue_passes_submitter_filter_to_database(review_client, filtered):
    client, actor = review_client
    submitter = uuid4() if filtered else None
    params = {"limit": 2, "offset": 1}
    if submitter:
        params["submitter_id"] = str(submitter)
    page = {"items": [], "total": 3, "limit": 2, "offset": 1}
    with (
        patch.object(reviews.repository, "assert_user_active"),
        patch.object(reviews.repository, "_rpc", return_value=page) as rpc,
        patch.object(reviews, "get_s3_client"),
    ):
        response = client.get("/reviews", params=params)
    assert response.status_code == 200
    assert response.json() == page
    rpc.assert_called_once_with(
        None,
        "hdn_review_queue",
        {
            "p_user_id": str(actor),
            "p_limit": 2,
            "p_offset": 1,
            "p_submitter_id": str(submitter) if submitter else None,
        },
    )


def test_review_queue_rejects_invalid_submitter_before_database_access(review_client):
    client, _ = review_client
    with (
        patch.object(reviews.repository, "assert_user_active"),
        patch.object(reviews.repository, "_rpc", return_value={"items": []}) as rpc,
        patch.object(reviews, "get_s3_client"),
    ):
        response = client.get("/reviews", params={"submitter_id": "not-a-uuid"})
    assert response.status_code == 422
    rpc.assert_not_called()
