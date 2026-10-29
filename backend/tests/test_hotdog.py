import base64
import io
import json
from urllib.parse import unquote, urlparse
from uuid import UUID, uuid4

import boto3
import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws
from PIL import Image
from smflw_api.auth import AuthUser, require_user
from smflw_api.main import app
from smflw_api.settings import get_settings

MAX_BYTES = 5 * 1024 * 1024
USER_ID = UUID("11111111-1111-4111-8111-111111111111")


@pytest.fixture
def storage(monkeypatch):
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": "eu-central-1",
        "AWS_REGION": "eu-central-1",
        "IMAGE_BUCKET": "hotdog-test",
        "S3_ENDPOINT_URL": "",
        "ANTHROPIC_API_KEY": "test-key",
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_PUBLISHABLE_KEY": "unused",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    get_settings.cache_clear()
    # These tests cover S3 and inference; account persistence is a separate boundary.
    from smflw_api import repository

    monkeypatch.setattr(repository, "assert_user_active", lambda *args: None)
    monkeypatch.setattr(
        repository,
        "claim_check",
        lambda *args: {"status": "claimed", "lease_id": str(uuid4())},
    )
    monkeypatch.setattr(
        repository, "complete_check", lambda *args: {"check_id": str(uuid4())}
    )
    monkeypatch.setattr(repository, "release_check", lambda *args: None)
    certificates = {}

    def register_certificate(settings, record, json_key, pdf_key):
        certificates[str(record.certificate_id)] = {
            "user_id": record.owner_id,
            "json_key": json_key,
            "pdf_key": pdf_key,
        }

    monkeypatch.setattr(repository, "register_certificate", register_certificate)
    monkeypatch.setattr(
        repository,
        "get_certificate_location",
        lambda settings, certificate_id: certificates.get(str(certificate_id)),
    )
    with mock_aws():
        client = boto3.client("s3", region_name="eu-central-1")
        client.create_bucket(
            Bucket="hotdog-test",
            CreateBucketConfiguration={"LocationConstraint": "eu-central-1"},
        )
        app.dependency_overrides[require_user] = lambda: AuthUser(id=USER_ID)
        try:
            yield client
        finally:
            app.dependency_overrides.pop(require_user, None)
    get_settings.cache_clear()


@pytest.fixture
def photo():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, format="PNG")
    return output.getvalue()


def store_photo(storage, photo, content_type="image/png"):
    upload_id = str(uuid4())
    storage.put_object(
        Bucket="hotdog-test",
        Key=f"uploads/{USER_ID}/{upload_id}",
        Body=photo,
        ContentType=content_type,
    )
    return upload_id


def mock_claude(monkeypatch, text, stop_reason="end_turn", status=200):
    from anthropic import Anthropic
    from smflw_api import classifier

    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        if status != 200:
            return httpx.Response(
                status,
                json={
                    "type": "error",
                    "error": {"type": "rate_limit_error", "message": "busy"},
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": "claude-haiku-5-5",
                "content": [{"type": "text", "text": text}],
                "stop_reason": stop_reason,
                "stop_sequence": None,
                "usage": {"input_tokens": 10, "output_tokens": 10},
            },
        )

    client = Anthropic(
        api_key="test-key",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(respond)),
    )
    monkeypatch.setattr(classifier, "get_anthropic_client", lambda settings: client)
    return requests


def test_upload_ticket_has_private_key_and_enforced_post_policy(storage, photo):
    response = TestClient(app).post(
        "/uploads",
        json={
            "content_type": "image/png",
            "size_bytes": len(photo),
        },
    )
    assert response.status_code == 200
    ticket = response.json()
    assert str(UUID(ticket["upload_id"])) == ticket["upload_id"]
    assert ticket["fields"]["key"] == f"uploads/{USER_ID}/{ticket['upload_id']}"
    policy = json.loads(base64.b64decode(ticket["fields"]["policy"]))
    assert {"Content-Type": "image/png"} in policy["conditions"]
    assert ["content-length-range", len(photo), len(photo)] in policy["conditions"]
    assert "acl" not in ticket["fields"]


@pytest.mark.parametrize(
    "content_type,size",
    [
        ("text/plain", 100),
        ("image/svg+xml", 100),
        ("image/png", 0),
        ("image/jpeg", MAX_BYTES + 1),
    ],
)
def test_invalid_upload_is_rejected(storage, content_type, size):
    response = TestClient(app).post(
        "/uploads",
        json={
            "content_type": content_type,
            "size_bytes": size,
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("answer", [True, False])
@pytest.mark.parametrize(
    "model,model_id,thinking",
    [
        ("haiku", "claude-haiku-5-5", "disabled"),
        ("sonnet", "claude-sonnet-5-5", "between_tools"),
    ],
)
def test_classification_uses_stored_image_and_returns_real_boolean(
    storage,
    photo,
    monkeypatch,
    answer,
    model,
    model_id,
    thinking,
):
    upload_id = store_photo(storage, photo)
    requests = mock_claude(monkeypatch, json.dumps({"is_hot_dog": answer}))
    response = TestClient(app).post(
        "/classify", json={"upload_id": upload_id, "model": model}
    )
    assert response.status_code == 200
    assert response.json()["is_hot_dog"] is answer
    certificate_id = response.json()["certificate_id"]
    certificate = TestClient(app).get(f"/certificates/{certificate_id}")
    assert certificate.status_code == 200
    assert certificate.json()["verified"] is True
    assert "owner_id" not in certificate.json()
    pdf = TestClient(app).get(
        f"/certificates/{certificate_id}/pdf", follow_redirects=False
    )
    assert pdf.status_code == 307
    signed_url = urlparse(pdf.headers["location"])
    assert signed_url.query
    pdf_object = storage.get_object(
        Bucket="hotdog-test",
        Key=unquote(signed_url.path.lstrip("/")).removeprefix("hotdog-test/"),
    )
    assert pdf_object["Body"].read().startswith(b"%PDF-")
    request = requests[0]
    assert request["model"] == model_id
    assert request["thinking"] == {"type": thinking}
    image = request["messages"][0]["content"][0]
    assert base64.b64decode(image["source"]["data"]) == photo
    assert image["source"]["media_type"] == "image/png"
    schema = request["output_config"]["format"]["schema"]
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert schema["properties"]["is_hot_dog"]["type"] == "boolean"
    assert schema["required"] == ["is_hot_dog"]
    assert schema["additionalProperties"] is False


def test_unknown_upload_is_not_sent_to_claude(storage):
    response = TestClient(app).post("/classify", json={"upload_id": str(uuid4())})
    assert response.status_code == 404


def test_arbitrary_s3_key_is_rejected(storage):
    response = TestClient(app).post("/classify", json={"upload_id": "../private/key"})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "data,content_type,status",
    [
        (b"not an image", "image/png", 400),
        (b"x" * (MAX_BYTES + 1), "image/png", 413),
    ],
)
def test_invalid_s3_object_is_rejected_before_llm(storage, data, content_type, status):
    upload_id = store_photo(storage, data, content_type)
    response = TestClient(app).post("/classify", json={"upload_id": upload_id})
    assert response.status_code == status


def test_mismatched_image_type_is_rejected(storage, photo):
    upload_id = store_photo(storage, photo, "image/jpeg")
    response = TestClient(app).post("/classify", json={"upload_id": upload_id})
    assert response.status_code == 400


@pytest.mark.parametrize(
    "text,reason",
    [
        ('{"is_hot_dog":"false"}', "end_turn"),
        ('{"is_hot_dog":false,"explanation":"extra"}', "end_turn"),
        ("I cannot answer.", "refusal"),
        ('{"is_hot_dog":', "max_tokens"),
    ],
)
def test_bad_or_refused_model_response_is_an_error_not_a_negative_result(
    storage,
    photo,
    monkeypatch,
    text,
    reason,
):
    upload_id = store_photo(storage, photo)
    mock_claude(monkeypatch, text, stop_reason=reason)
    response = TestClient(app).post("/classify", json={"upload_id": upload_id})
    assert response.status_code == 502
    assert "is_hot_dog" not in response.json()


def test_provider_rate_limit_has_a_retryable_error(storage, photo, monkeypatch):
    upload_id = store_photo(storage, photo)
    mock_claude(monkeypatch, "", status=429)
    response = TestClient(app).post("/classify", json={"upload_id": upload_id})
    assert response.status_code == 503
