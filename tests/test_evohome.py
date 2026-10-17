import asyncio
import logging
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import aiohttp
import pytest
from evohomeasync2 import (
    ApiRateLimitExceededError,
    AuthenticationFailedError,
    AuthRateLimitExceededError,
    BadApiResponseError,
)

from home_automation import evohome


def fake_location(id, temperatures=(0.0, None)):
    zones = [
        NS(
            id=f"{id}-{i}",
            name=f"Room {i}",
            temperature=temp,
            target_heat_temperature=20.0,
            mode="FollowSchedule",
        )
        for i, temp in enumerate(temperatures)
    ]
    return NS(
        id=id,
        name=f"Home {id}",
        get_status=AsyncMock(),
        gateways=[
            NS(
                id=f"{id}-gateway-{i}",
                systems=[NS(id=f"{id}-system-{i}", mode="Auto", zones=zones)],
            )
            for i in range(2)
        ],
    )


def test_discovers_all_locations_gateways_and_unavailable_zones():
    locations = [fake_location("1"), fake_location("2")]
    client = NS(setup=AsyncMock(), locations=locations)
    snapshot = asyncio.run(evohome.read_client(client))
    assert snapshot.source == "evohome"
    assert len(snapshot.locations) == 2
    assert sum(len(loc.systems) for loc in snapshot.locations) == 4
    for location, result in zip(locations, snapshot.locations, strict=True):
        location.get_status.assert_awaited_once_with(raise_on_stale_config=True)
        assert result.systems[0].zones[0].temperature_c == 0.0
        assert result.systems[0].zones[0].available
        assert not result.systems[0].zones[1].available
    client.setup.assert_awaited_once()


@pytest.mark.parametrize("locations", [[], [fake_location("empty", ())]])
def test_empty_account_is_not_reported_as_connected(locations):
    with pytest.raises(evohome.ConnectionProblem, match="No heating zones"):
        asyncio.run(evohome.read_client(NS(setup=AsyncMock(), locations=locations)))


@pytest.mark.parametrize(
    "error, message",
    [
        (AuthenticationFailedError("SECRET response"), "Sign-in failed"),
        (ApiRateLimitExceededError("SECRET response"), "rate limit"),
        (AuthRateLimitExceededError("SECRET response"), "rate limit"),
        (BadApiResponseError("SECRET response"), "Could not read"),
        (aiohttp.ClientConnectionError("SECRET response"), "Could not read"),
        (TimeoutError("SECRET response"), "did not respond"),
    ],
)
def test_vendor_failures_are_safe_and_sessions_close(monkeypatch, error, message):
    sessions = []
    original_session = aiohttp.ClientSession

    def session_factory(**kwargs):
        session = original_session(**kwargs)
        sessions.append(session)
        assert kwargs["trust_env"] is True
        return session

    monkeypatch.setattr(evohome.aiohttp, "ClientSession", session_factory)
    monkeypatch.setattr(evohome, "read_client", AsyncMock(side_effect=error))
    with pytest.raises(evohome.ConnectionProblem, match=message) as result:
        asyncio.run(evohome.fetch_status("test@example.invalid", "fake-password"))
    assert "SECRET" not in str(result.value)
    assert sessions[0].closed


def test_real_token_manager_authenticates_once_and_reuses_token(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    request = AsyncMock(
        return_value={
            "access_token": "test-access",
            "refresh_token": "test-refresh",
            "expires_in": 3600,
            "token_type": "bearer",
            "scope": "EMEA-V1-Basic",
        }
    )
    monkeypatch.setattr(
        evohome.MemoryTokenManager, "_post_access_token_request", request
    )

    async def run():
        async with aiohttp.ClientSession() as session:
            manager = evohome.MemoryTokenManager(
                "test@example.invalid",
                "fake-password",
                session,
                logging.getLogger("test"),
            )
            assert await manager.get_access_token() == "test-access"
            assert await manager.get_access_token() == "test-access"
            request.assert_awaited_once()
            assert (
                request.call_args.args[0]
                == "https://tccna.resideo.com/Auth/OAuth/Token"
            )
            assert (
                request.call_args.kwargs["data"]["Username"] == "test@example.invalid"
            )

    asyncio.run(run())
    assert list(tmp_path.iterdir()) == []


def test_service_coalesces_requests_and_refreshes_after_five_minutes(monkeypatch):
    clock = [10.0]
    monkeypatch.setattr(evohome.time, "monotonic", lambda: clock[0])
    fetch = AsyncMock(return_value=evohome.demo_snapshot())
    monkeypatch.setattr(evohome, "read_client", fetch)

    async def run():
        service = evohome.EvohomeService(NS())
        a, b = await asyncio.gather(service.status(), service.status())
        assert a is b
        fetch.assert_awaited_once()
        clock[0] += 301
        await service.status()
        assert fetch.await_count == 2

    asyncio.run(run())


def test_service_does_not_repeat_failed_sign_in_during_cooldown(monkeypatch):
    fetch = AsyncMock(side_effect=AuthenticationFailedError("SECRET response"))
    monkeypatch.setattr(evohome, "read_client", fetch)

    async def run():
        service = evohome.EvohomeService(NS())
        for _ in range(2):
            with pytest.raises(evohome.ConnectionProblem, match="Sign-in failed"):
                await service.status()
        fetch.assert_awaited_once()

    asyncio.run(run())
