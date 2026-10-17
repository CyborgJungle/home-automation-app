"""Read Evohome heating status through the TCC Europe/UK API."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime

import aiohttp
from evohomeasync2 import (
    AbstractTokenManager,
    ApiRateLimitExceededError,
    AuthenticationFailedError,
    EvohomeClient,
    EvohomeError,
)


class ConnectionProblem(Exception):
    """A user-facing error that contains no raw API response or credentials."""


class MemoryTokenManager(AbstractTokenManager):
    """Reuse tokens in this process without persisting account secrets."""

    async def save_access_token(self) -> None:
        """Keep the access and refresh tokens only in the inherited memory fields."""


@dataclass(frozen=True)
class ZoneReading:
    id: str
    name: str
    temperature_c: float | None
    target_c: float
    mode: str

    @property
    def available(self) -> bool:
        return self.temperature_c is not None


@dataclass(frozen=True)
class SystemReading:
    id: str
    gateway_id: str
    mode: str
    zones: list[ZoneReading]


@dataclass(frozen=True)
class LocationReading:
    id: str
    name: str
    systems: list[SystemReading]


@dataclass(frozen=True)
class HomeSnapshot:
    observed_at: str
    source: str
    locations: list[LocationReading]


async def read_client(client: EvohomeClient) -> HomeSnapshot:
    """Fetch configuration once and one status response per location."""
    await client.setup()
    locations = []
    for location in client.locations:
        await location.get_status(raise_on_stale_config=True)
        systems = []
        for gateway in location.gateways:
            for system in gateway.systems:
                zones = [
                    ZoneReading(
                        id=zone.id,
                        name=zone.name,
                        temperature_c=zone.temperature,
                        target_c=zone.target_heat_temperature,
                        mode=str(zone.mode),
                    )
                    for zone in system.zones
                ]
                systems.append(
                    SystemReading(system.id, gateway.id, str(system.mode), zones)
                )
        locations.append(LocationReading(location.id, location.name, systems))
    if not any(system.zones for loc in locations for system in loc.systems):
        raise ConnectionProblem(
            "No heating zones found. Check your Evohome installation in the TCC app."
        )
    return HomeSnapshot(datetime.now(UTC).isoformat(), "evohome", locations)


@asynccontextmanager
async def connection(username: str, password: str):
    """Keep tokens and the HTTPS session alive for this connection's lifetime."""
    # Raw upstream messages can contain account data. Keep them out of CLI logs.
    logger = logging.Logger("home_automation.evohome.vendor")
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=30), trust_env=True
    ) as session:
        tokens = MemoryTokenManager(username, password, session, logger)
        client = EvohomeClient(tokens)
        # The vendor exposes a shared logger. Restore its state when we close.
        was_disabled = client.logger.disabled
        client.logger.disabled = True
        try:
            yield client
        finally:
            client.logger.disabled = was_disabled


@asynccontextmanager
async def safe_api_errors():
    """Translate vendor errors without exposing raw account data."""
    try:
        async with asyncio.timeout(60):
            yield
    except ApiRateLimitExceededError:
        raise ConnectionProblem(
            "Honeywell's API rate limit was reached. Wait before trying again."
        ) from None
    except AuthenticationFailedError:
        raise ConnectionProblem(
            "Sign-in failed. Check your TCC Europe/UK account and accept any "
            "updated terms in the TCC app."
        ) from None
    except TimeoutError:
        raise ConnectionProblem(
            "Honeywell did not respond in time. Try again later."
        ) from None
    except (EvohomeError, aiohttp.ClientError):
        raise ConnectionProblem(
            "Could not read Evohome status. Check connectivity to "
            "tccna.resideo.com and your installation in the TCC app."
        ) from None


async def fetch_status(username: str, password: str) -> HomeSnapshot:
    """Connect once, retrieve a snapshot, and close the HTTP session."""
    async with safe_api_errors(), connection(username, password) as client:
        return await read_client(client)


class EvohomeService:
    """Reuse authentication and cache readings for five minutes per warm worker.

    This cache is an optimization, not durable storage or a global rate limiter.
    """

    def __init__(self, client: EvohomeClient):
        self.client = client
        self.lock = asyncio.Lock()
        self.snapshot: HomeSnapshot | None = None
        self.retry_at = 0.0
        self.problem: ConnectionProblem | None = None

    async def status(self) -> HomeSnapshot:
        async with self.lock:
            if time.monotonic() < self.retry_at:
                if self.problem:
                    raise self.problem
                if self.snapshot:
                    return self.snapshot
            self.retry_at = time.monotonic() + 300
            try:
                async with safe_api_errors():
                    self.snapshot = await read_client(self.client)
            except ConnectionProblem as error:
                self.problem = error
                raise
            self.problem = None
            return self.snapshot


def demo_snapshot() -> HomeSnapshot:
    """Sample readings, never mistaken for a live home connection."""
    return HomeSnapshot(
        datetime.now(UTC).isoformat(),
        "demo",
        [
            LocationReading(
                "demo-home",
                "Demo home",
                [
                    SystemReading(
                        "demo-system",
                        "demo-gateway",
                        "Auto",
                        [
                            ZoneReading(
                                "demo-1", "Living room", 20.5, 21, "FollowSchedule"
                            ),
                            ZoneReading("demo-2", "Bedroom", 18, 18, "FollowSchedule"),
                            ZoneReading("demo-3", "Study", None, 19, "FollowSchedule"),
                        ],
                    )
                ],
            )
        ],
    )
