from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from home_automation.evohome import ConnectionProblem, demo_snapshot
from home_automation.web import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DASHBOARD_USERNAME", "owner")
    monkeypatch.setenv("DASHBOARD_PASSWORD", "test-dashboard-password")
    monkeypatch.delenv("EVOHOME_USERNAME", raising=False)
    monkeypatch.delenv("EVOHOME_PASSWORD", raising=False)
    with TestClient(app) as client:
        yield client


AUTH = ("owner", "test-dashboard-password")


@pytest.mark.parametrize(
    "path", ["/", "/api/evohome/status?demo=true", "/api/evohome/status"]
)
def test_all_home_data_requires_login(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert "Basic" in response.headers["www-authenticate"]
    assert response.headers["cache-control"] == "no-store"
    assert client.get(path, auth=("owner", "wrong-password")).status_code == 401


def test_dashboard_and_demo_work_without_honeywell_credentials(client):
    response = client.get("/", auth=AUTH)
    assert response.status_code == 200
    assert "Your home, in harmony." in response.text
    assert response.headers["x-frame-options"] == "DENY"
    demo = client.get("/api/evohome/status?demo=true", auth=AUTH)
    assert demo.status_code == 200
    assert demo.json()["source"] == "demo"
    assert len(demo.json()["locations"][0]["systems"][0]["zones"]) == 3


def test_missing_honeywell_account_is_not_claimed_connected(client):
    response = client.get("/api/evohome/status", auth=AUTH)
    assert response.status_code == 503
    assert "not been connected" in response.json()["detail"]


def test_unconfigured_dashboard_fails_closed(client, monkeypatch):
    monkeypatch.delenv("DASHBOARD_PASSWORD")
    assert client.get("/", auth=AUTH).status_code == 503
    assert client.get("/api/evohome/status?demo=true", auth=AUTH).status_code == 503


def test_api_invokes_device_service_and_reports_failure(client):
    status = AsyncMock(return_value=demo_snapshot())
    app.state.evohome = SimpleNamespace(status=status)
    assert client.get("/api/evohome/status", auth=AUTH).status_code == 200
    status.assert_awaited_once()
    status.side_effect = ConnectionProblem("Honeywell did not respond in time.")
    response = client.get("/api/evohome/status", auth=AUTH)
    assert response.status_code == 502
    assert response.json()["detail"] == "Honeywell did not respond in time."


def test_no_heating_control_routes_are_exposed(client):
    assert client.post("/api/evohome/status", auth=AUTH).status_code == 405
    assert client.get("/docs", auth=AUTH).status_code == 404
