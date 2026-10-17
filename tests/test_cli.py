import json
from unittest.mock import AsyncMock

import pytest

from home_automation import cli


@pytest.fixture(autouse=True)
def no_credentials(monkeypatch):
    monkeypatch.delenv("EVOHOME_USERNAME", raising=False)
    monkeypatch.delenv("EVOHOME_PASSWORD", raising=False)


def test_demo_is_offline_and_distinguishes_unavailable_sensors(monkeypatch, capsys):
    fetch = AsyncMock(side_effect=AssertionError("Demo must not connect"))
    monkeypatch.setattr(cli, "fetch_status", fetch)
    assert cli.main(["evohome", "status", "--demo", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["source"] == "demo"
    zones = data["locations"][0]["systems"][0]["zones"]
    assert zones[0]["temperature_c"] == 20.5
    assert zones[2]["temperature_c"] is None
    assert zones[2]["available"] is False
    fetch.assert_not_awaited()


def test_live_command_fails_without_secrets_or_prompt(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda _: pytest.fail("Must not prompt"))
    assert cli.main(["evohome", "status", "--no-input"]) == 1
    captured = capsys.readouterr()
    assert not captured.out
    assert "EVOHOME_PASSWORD" in captured.err


def test_interactive_password_is_hidden(monkeypatch):
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda _: " test@example.invalid ")
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: " fake password ")
    assert cli.credentials(False) == ("test@example.invalid", " fake password ")


def test_environment_credentials_avoid_prompt_and_preserve_password(monkeypatch):
    monkeypatch.setenv("EVOHOME_USERNAME", " test@example.invalid ")
    monkeypatch.setenv("EVOHOME_PASSWORD", " fake password ")
    assert cli.credentials(True) == ("test@example.invalid", " fake password ")
