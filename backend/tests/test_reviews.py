"""Trust-boundary checks without network or infrastructure."""

from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from smflw_api import certificates, reviews


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
    original = certificates.CertificateRecord(
        **fields, record_sha256=certificates._digest(fields)
    )
    before = original.model_dump_json()
    certificates._validate_integrity(original)
    with patch.object(certificates, "_persist_certificate") as persist:
        human = certificates.stage_human_certificate(
            None, original, uuid4(), uuid4(), False, datetime.now(UTC)
        )
    persist.assert_called_once_with(None, human, register=False)
    assert original.model_dump_json() == before
    assert human.schema_version == 2
    assert human.original_certificate_id == original.certificate_id
    assert human.is_hot_dog is False
    assert "owner_id" not in certificates.public_record(human)
    certificates._validate_integrity(human)


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
