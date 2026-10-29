from fastapi.testclient import TestClient
from smflw_api.main import app


def test_health_is_available_without_database_access():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
