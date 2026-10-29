"""Certificate images and reviewer identity cross storage/privacy boundaries."""

import hashlib
import io
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException
from PIL import Image
from smflw_api import certificates, privacy, reviews
from smflw_api.certificate_records import CertificateRecord, record_digest


def missing():
    return ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")


@pytest.fixture
def photo():
    out = io.BytesIO()
    image = Image.new("RGB", (800, 400), "red")
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private location"
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


@pytest.fixture
def record(photo):
    fields = dict(
        schema_version=1,
        certificate_id=str(uuid4()),
        issuer="Hot Dog or Not",
        issued_at="2026-10-29T21:00:00Z",
        image_sha256=hashlib.sha256(photo).hexdigest(),
        is_hot_dog=True,
        classifier_model="test-model",
        owner_id=str(uuid4()),
    )
    return CertificateRecord(**fields, record_sha256=record_digest(fields))


@pytest.fixture
def human(record):
    with patch.object(certificates, "_persist_certificate"):
        return certificates.stage_human_certificate(
            None, record, uuid4(), uuid4(), False, datetime.now(UTC)
        )


@pytest.fixture
def env(monkeypatch):
    settings = SimpleNamespace(
        image_bucket="test", public_web_url="https://example.com"
    )
    objects = {}
    client = MagicMock()

    def get_object(*, Bucket, Key):
        if Key not in objects:
            raise missing()
        return {"Body": io.BytesIO(objects[Key])}

    def put_object(**kwargs):
        objects[kwargs["Key"]] = kwargs["Body"]

    def head_object(*, Bucket, Key):
        if Key not in objects:
            raise missing()
        return {}

    client.get_object.side_effect = get_object
    client.put_object.side_effect = put_object
    client.head_object.side_effect = head_object
    client.delete_objects.return_value = {}
    client.get_paginator.return_value.paginate.return_value = []
    client.generate_presigned_url.return_value = "https://signed.example/pdf"
    monkeypatch.setattr(certificates, "get_s3_client", lambda settings: client)
    monkeypatch.setattr(privacy, "get_s3_client", lambda settings: client)
    monkeypatch.setattr(reviews, "get_s3_client", lambda settings: client)
    monkeypatch.setattr(certificates.repository, "assert_user_active", Mock())
    monkeypatch.setattr(certificates.repository, "_client", MagicMock())
    monkeypatch.setattr(
        certificates.repository, "_execute", Mock(return_value=SimpleNamespace(data=[]))
    )
    monkeypatch.setattr(certificates.repository, "register_certificate", Mock())
    monkeypatch.setattr(
        certificates.repository,
        "get_certificate_location",
        Mock(return_value={"user_id": "unused"}),
    )
    return settings, client, objects


def test_preview_orients_scales_and_strips_metadata(photo):
    data = certificates._image_preview(photo)
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "JPEG"
        assert image.size == (120, 240)
        assert not image.getexif()


def test_persistence_rolls_back_preview_on_registration_failure(
    env, record, photo, monkeypatch
):
    settings, client, objects = env
    monkeypatch.setattr(
        certificates, "render_certificate", Mock(return_value=b"%PDF-test")
    )
    certificates.repository.register_certificate.side_effect = HTTPException(
        409, "erasing"
    )
    with pytest.raises(HTTPException):
        certificates._persist_certificate(settings, record, image_bytes=photo)
    prefix = f"certificates/{record.owner_id}/{record.certificate_id}"
    deleted = client.delete_objects.call_args.kwargs["Delete"]["Objects"]
    assert {item["Key"] for item in deleted} == {
        prefix + suffix for suffix in (".json", ".pdf", ".preview.jpg")
    }
    assert objects[prefix + ".json"] == record.model_dump_json().encode()
    certificates.render_certificate.assert_called_once()
    assert (
        certificates.render_certificate.call_args.kwargs["image_bytes"]
        == objects[prefix + ".preview.jpg"]
    )


def test_human_stage_receives_image_and_trusted_name_without_mutating_evidence(
    record, photo
):
    with patch.object(certificates, "_persist_certificate") as persist:
        human = certificates.stage_human_certificate(
            None,
            record,
            uuid4(),
            uuid4(),
            False,
            datetime.now(UTC),
            image_bytes=photo,
            reviewer_name="Ada Lovelace",
        )
    assert persist.call_args.kwargs["image_bytes"] == photo
    assert persist.call_args.kwargs["reviewer_name"] == "Ada Lovelace"
    assert human.reviewer_name == "Authorized team supervisor"
    assert "owner_id" not in certificates.public_record(human)


def test_human_preview_falls_back_to_original_thumbnail(env, human):
    settings, client, objects = env
    objects[
        f"certificates/{human.owner_id}/{human.original_certificate_id}.preview.jpg"
    ] = b"original-thumbnail"
    assert (
        certificates._certificate_preview(settings, human, client)
        == b"original-thumbnail"
    )
    certificates.repository._execute.assert_not_called()


@pytest.mark.parametrize("image_state", ["valid", "missing", "tampered"])
def test_historical_original_is_owner_scoped_and_hash_verified(
    env, record, photo, image_state
):
    settings, client, objects = env
    upload_id = uuid4()
    key = f"uploads/{record.owner_id}/{upload_id}"
    certificates.repository._execute.return_value.data = [
        {
            "upload_id": str(upload_id),
            "image_key": key,
            "image_sha256": record.image_sha256,
        }
    ]
    if image_state != "missing":
        objects[key] = photo if image_state == "valid" else b"different image"
    if image_state == "tampered":
        with pytest.raises(HTTPException) as error:
            certificates._certificate_preview(settings, record, client)
        assert error.value.status_code == 409
    else:
        result = certificates._certificate_preview(settings, record, client)
        assert result == (
            certificates._image_preview(photo) if image_state == "valid" else None
        )


def test_historical_foreign_image_key_rejected(env, record):
    settings, client, _ = env
    upload_id = uuid4()
    certificates.repository._execute.return_value.data = [
        {
            "upload_id": str(upload_id),
            "image_key": f"uploads/{uuid4()}/{upload_id}",
            "image_sha256": record.image_sha256,
        }
    ]
    with pytest.raises(HTTPException) as error:
        certificates._certificate_preview(settings, record, client)
    assert error.value.status_code == 409
    assert client.get_object.call_count == 1


def test_image_access_denial_is_not_a_missing_thumbnail(env, record, monkeypatch):
    settings, client, _ = env
    monkeypatch.setattr(certificates, "get_certificate", lambda *args: record)
    client.get_object.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied"}}, "GetObject"
    )
    with pytest.raises(HTTPException) as error:
        certificates.signed_certificate_download(settings, record.certificate_id)
    assert error.value.status_code == 503
    client.put_object.assert_not_called()


def test_download_uses_design_v3_and_preserves_json(env, record, photo, monkeypatch):
    settings, client, objects = env
    prefix = f"certificates/{record.owner_id}/{record.certificate_id}"
    objects[prefix + ".preview.jpg"] = certificates._image_preview(photo)
    objects[prefix + ".json"] = record.model_dump_json().encode()
    monkeypatch.setattr(certificates, "get_certificate", lambda *args: record)
    renderer = Mock(return_value=b"%PDF-v3")
    monkeypatch.setattr(certificates, "render_certificate", renderer)
    result = certificates.signed_certificate_download(settings, record.certificate_id)
    assert result["expires_in"] == 300
    assert objects[prefix + ".json"] == record.model_dump_json().encode()
    assert objects[prefix + ".design-v3.pdf"] == b"%PDF-v3"
    assert renderer.call_args.kwargs["image_bytes"] == objects[prefix + ".preview.jpg"]
    assert client.generate_presigned_url.call_args.kwargs["Params"]["Key"].endswith(
        ".design-v3.pdf"
    )


def test_reviewer_lookup_never_uses_email_fallback(env, human, monkeypatch):
    settings, _, _ = env
    reviewer = str(uuid4())
    certificates.repository._execute.return_value.data = [{"reviewer_id": reviewer}]
    rpc = Mock(side_effect=[True, "Ada Lovelace"])
    monkeypatch.setattr(certificates.repository, "_rpc", rpc)
    assert certificates._reviewer_name(settings, human) == "Ada Lovelace"
    assert [call.args[1] for call in rpc.call_args_list] == [
        "hdn_user_active",
        "hdn_review_name",
    ]
    rpc.reset_mock(side_effect=True)
    rpc.return_value = False
    assert certificates._reviewer_name(settings, human) == "Deleted account"
    assert rpc.call_count == 1


def test_reviewer_erasure_during_render_removes_named_pdf(env, human, monkeypatch):
    settings, client, objects = env
    monkeypatch.setattr(certificates, "get_certificate", lambda *args: human)
    monkeypatch.setattr(certificates, "_certificate_preview", lambda *args: None)
    monkeypatch.setattr(
        certificates,
        "_reviewer_name",
        Mock(side_effect=["Ada Lovelace", "Deleted account"]),
    )
    monkeypatch.setattr(
        certificates, "render_certificate", Mock(return_value=b"%PDF-Ada")
    )
    with pytest.raises(HTTPException) as error:
        certificates.signed_certificate_download(settings, human.certificate_id)
    assert error.value.status_code == 409
    assert client.delete_object.call_args.kwargs["Key"].endswith(".design-v3.pdf")
    client.generate_presigned_url.assert_not_called()


def test_reviewer_erasure_removes_other_owners_named_pdfs(env, human):
    settings, client, _ = env
    certificates.repository._execute.return_value.data = [
        {
            "user_id": human.owner_id,
            "certificate_id": str(human.certificate_id),
        }
    ]
    privacy.cleanup_user_assets(settings, uuid4())
    deleted = client.delete_objects.call_args.kwargs["Delete"]["Objects"]
    prefix = f"certificates/{human.owner_id}/{human.certificate_id}"
    assert {item["Key"] for item in deleted} == {
        prefix + suffix for suffix in (".pdf", ".design-v2.pdf", ".design-v3.pdf")
    }


def test_reviewer_pdf_erasure_failure_is_retryable(env, human):
    settings, client, _ = env
    certificates.repository._execute.return_value.data = [
        {
            "user_id": human.owner_id,
            "certificate_id": str(human.certificate_id),
        }
    ]
    client.delete_objects.return_value = {"Errors": [{"Code": "AccessDenied"}]}
    with pytest.raises(RuntimeError):
        privacy.cleanup_user_assets(settings, uuid4())


@pytest.mark.parametrize("completion_error", [None, "inactive"])
def test_review_decision_passes_trusted_name_and_cleans_rejected_preview(
    env, record, photo, monkeypatch, completion_error
):
    settings, client, objects = env
    reviewer_id, review_id, lease_id, team_id, check_id = (uuid4() for _ in range(5))
    key = f"certificates/{record.owner_id}/review-images/{review_id}"
    objects[key] = photo
    certificates.repository._execute.return_value.data = [
        {
            "certificate_id": str(record.certificate_id),
            "model_id": record.classifier_model,
            "is_hot_dog": record.is_hot_dog,
            "image_sha256": record.image_sha256,
            "size_bytes": len(photo),
        }
    ]

    def rpc(settings, name, params):
        if name == "hdn_claim_review":
            return dict(
                user_id=record.owner_id,
                image_key=key,
                check_id=str(check_id),
                team_id=str(team_id),
                lease_id=str(lease_id),
            )
        if name == "hdn_review_name":
            assert params == {"p_user_id": str(reviewer_id)}
            return "Ada Lovelace"
        if name == "hdn_complete_review":
            return (
                {"error": completion_error}
                if completion_error
                else {"status": "completed"}
            )
        return None

    monkeypatch.setattr(certificates.repository, "_rpc", rpc)
    monkeypatch.setattr(reviews, "get_certificate", lambda *args: record)
    stage = Mock()
    monkeypatch.setattr(reviews, "stage_human_certificate", stage)
    if completion_error:
        with pytest.raises(HTTPException) as error:
            reviews.decide_review(settings, reviewer_id, review_id, False)
        assert error.value.status_code == 409
        deleted = client.delete_objects.call_args.kwargs["Delete"]["Objects"]
        certificate_id = stage.call_args.args[3]
        prefix = f"certificates/{record.owner_id}/{certificate_id}"
        assert {item["Key"] for item in deleted} == {
            prefix + suffix for suffix in (".json", ".pdf", ".preview.jpg")
        }
    else:
        assert reviews.decide_review(settings, reviewer_id, review_id, False) == {
            "status": "completed"
        }
    assert stage.call_args.kwargs == {
        "image_bytes": photo,
        "reviewer_name": "Ada Lovelace",
    }
