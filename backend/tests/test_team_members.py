from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from smflw_api.auth import AuthUser, require_user
from smflw_api.main import app
from smflw_api.settings import get_settings


@pytest.fixture
def client():
    app.dependency_overrides[get_settings] = lambda: None
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(require_user, None)


def test_member_removal_requires_authentication(client):
    with patch("smflw_api.repository._rpc") as rpc:
        assert client.delete(f"/teams/members/{uuid4()}").status_code == 401
        rpc.assert_not_called()


@pytest.mark.parametrize(
    "error,status", [("forbidden", 403), ("last_admin", 409), ("missing_member", 404)]
)
def test_member_removal_uses_authenticated_identity_and_preserves_denials(
    client, error, status
):
    actor, target = uuid4(), uuid4()
    app.dependency_overrides[require_user] = lambda: AuthUser(id=actor)
    with patch("smflw_api.repository._rpc", return_value={"error": error}) as rpc:
        response = client.delete(f"/teams/members/{target}")
        assert response.status_code == status
        rpc.assert_called_once_with(
            None,
            "hdn_remove_member",
            {"p_user_id": str(actor), "p_member_id": str(target)},
        )
