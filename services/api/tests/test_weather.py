"""Tests for the weather layer.

Parsing runs against a recorded Open-Meteo response, so results do not change with the
weather. The network is never touched.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.weather.cache import CACHE_VERSION, ForecastCache, _encode
from app.weather.client import (
    HOURLY_FIELDS,
    ForecastUnavailableError,
    OpenMeteoClient,
    normalise,
)
from app.weather.models import Forecast, Location
from app.weather.service import WeatherService

FIXTURE = Path(__file__).parent / "fixtures" / "open-meteo-istanbul.json"
ISTANBUL = Location(latitude=41.0082, longitude=28.9784, timezone="Europe/Istanbul")


@pytest.fixture
def payload() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


class FakeRedis:
    """Enough Redis for these tests, with a switch for making it fail."""

    def __init__(self, *, broken: bool = False) -> None:
        self.store: dict[str, str] = {}
        self.broken = broken

    async def get(self, key: str) -> str | None:
        if self.broken:
            raise ConnectionError("redis is down")
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        if self.broken:
            raise ConnectionError("redis is down")
        self.store[key] = value


class TestNormalise:
    def test_reads_every_hour(self, payload: dict[str, Any]) -> None:
        forecast = normalise(payload, ISTANBUL)
        assert len(forecast.hours) == len(payload["hourly"]["time"])

    def test_local_time_becomes_utc(self, payload: dict[str, Any]) -> None:
        """The part most likely to be wrong, and silently.

        Open-Meteo returns naive local timestamps plus an offset. Istanbul is UTC+3, so
        local midnight is 21:00 UTC the day before.
        """
        forecast = normalise(payload, ISTANBUL)
        first = forecast.hours[0]
        local_iso = payload["hourly"]["time"][0]
        offset = payload["utc_offset_seconds"]

        assert first.hour_utc.tzinfo is UTC
        assert first.hour_utc == datetime.fromisoformat(local_iso).replace(
            tzinfo=UTC
        ) - timedelta(seconds=offset)

    def test_local_hour_stays_local(self, payload: dict[str, Any]) -> None:
        forecast = normalise(payload, ISTANBUL)
        for hour, raw in zip(forecast.hours, payload["hourly"]["time"], strict=True):
            assert hour.local_hour == int(raw[11:13])

    def test_local_hour_and_utc_hour_differ_by_the_offset(
        self, payload: dict[str, Any]
    ) -> None:
        forecast = normalise(payload, ISTANBUL)
        offset_hours = payload["utc_offset_seconds"] // 3600
        for hour in forecast.hours:
            assert hour.local_hour == (hour.hour_utc.hour + offset_hours) % 24

    def test_carries_the_weather_code(self, payload: dict[str, Any]) -> None:
        forecast = normalise(payload, ISTANBUL)
        codes = {hour.weather_code for hour in forecast.hours}
        assert codes == set(payload["hourly"]["weather_code"])

    def test_prefers_the_timezone_the_service_resolved(self, payload: dict[str, Any]) -> None:
        forecast = normalise(payload, Location(41.0, 28.9, "Etc/UTC"))
        assert forecast.location.timezone == payload["timezone"]

    def test_stamps_when_it_was_fetched(self, payload: dict[str, Any]) -> None:
        before = datetime.now(UTC)
        forecast = normalise(payload, ISTANBUL)
        assert before <= forecast.fetched_at <= datetime.now(UTC)


class TestNormaliseRejects:
    def test_a_body_with_no_hourly_block(self) -> None:
        with pytest.raises(ForecastUnavailableError, match="no hourly block"):
            normalise({"utc_offset_seconds": 0}, ISTANBUL)

    def test_a_response_missing_weather_code(self, payload: dict[str, Any]) -> None:
        """Requesting fewer fields must fail loudly.

        Without `weather_code` the scoring engine cannot exclude a thunderstorm and the
        atmosphere layer cannot tell snow from rain. Defaulting it to zero would mean
        "clear sky" — the most dangerous possible guess.
        """
        del payload["hourly"]["weather_code"]
        with pytest.raises(ForecastUnavailableError, match="weather_code"):
            normalise(payload, ISTANBUL)

    def test_a_response_with_no_offset(self, payload: dict[str, Any]) -> None:
        del payload["utc_offset_seconds"]
        with pytest.raises(ForecastUnavailableError, match="utc_offset_seconds"):
            normalise(payload, ISTANBUL)

    def test_a_response_with_no_usable_hours(self, payload: dict[str, Any]) -> None:
        for field in HOURLY_FIELDS:
            payload["hourly"][field] = [None] * len(payload["hourly"]["time"])
        with pytest.raises(ForecastUnavailableError, match="no usable hours"):
            normalise(payload, ISTANBUL)


class TestNormaliseSkipsGaps:
    def test_an_hour_with_a_null_is_dropped_not_zeroed(self, payload: dict[str, Any]) -> None:
        """A gap in the trace is honest; a zero would be scored as a measurement."""
        payload["hourly"]["temperature_2m"][3] = None
        forecast = normalise(payload, ISTANBUL)

        assert len(forecast.hours) == len(payload["hourly"]["time"]) - 1
        dropped_local_hour = int(payload["hourly"]["time"][3][11:13])
        first_day = [
            h for h in forecast.hours if h.hour_utc.date() == forecast.hours[0].hour_utc.date()
        ]
        assert all(h.local_hour != dropped_local_hour for h in first_day[:6])


class TestClient:
    @pytest.mark.asyncio
    async def test_requests_every_field_it_needs(self, payload: dict[str, Any]) -> None:
        seen: dict[str, str] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen.update(request.url.params)
            return httpx.Response(200, json=payload)

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http:
            client = OpenMeteoClient("https://api.open-meteo.com/v1", client=http)
            await client.fetch(ISTANBUL, days=3)

        assert set(seen["hourly"].split(",")) == set(HOURLY_FIELDS)
        assert seen["timezone"] == "Europe/Istanbul"
        assert seen["forecast_days"] == "3"

    @pytest.mark.asyncio
    async def test_a_server_error_becomes_forecast_unavailable(self) -> None:
        transport = httpx.MockTransport(lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=transport) as http:
            client = OpenMeteoClient("https://api.open-meteo.com/v1", client=http)
            with pytest.raises(ForecastUnavailableError):
                await client.fetch(ISTANBUL)

    @pytest.mark.asyncio
    async def test_a_network_failure_becomes_forecast_unavailable(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http:
            client = OpenMeteoClient("https://api.open-meteo.com/v1", client=http)
            with pytest.raises(ForecastUnavailableError):
                await client.fetch(ISTANBUL)


class TestCache:
    @pytest.mark.asyncio
    async def test_round_trips_a_forecast(self, payload: dict[str, Any]) -> None:
        cache = ForecastCache(FakeRedis())
        original = normalise(payload, ISTANBUL)

        await cache.set(ISTANBUL, original, days=3)
        restored = await cache.get(ISTANBUL, days=3)

        assert restored is not None
        assert restored.hours == original.hours
        assert restored.fetched_at == original.fetched_at
        assert restored.location == original.location

    @pytest.mark.asyncio
    async def test_neighbours_share_an_entry(self, payload: dict[str, Any]) -> None:
        """Rounding to two decimals is ~1 km, and the forecast really is identical."""
        cache = ForecastCache(FakeRedis())
        await cache.set(ISTANBUL, normalise(payload, ISTANBUL), days=3)

        next_street = Location(latitude=41.0089, longitude=28.9781, timezone="Europe/Istanbul")
        assert await cache.get(next_street, days=3) is not None

    @pytest.mark.asyncio
    async def test_stores_under_the_requested_coordinates_not_the_grid_ones(
        self, payload: dict[str, Any]
    ) -> None:
        """Regression: the cache silently never hit.

        Open-Meteo snaps coordinates to its model grid — 41.0082, 28.9784 comes back as
        41.0, 29.0, which rounds to a different key. Writing under the response's
        location meant every write went somewhere no read would look: no error, no
        warning, just every request going upstream forever.
        """
        redis = FakeRedis()
        cache = ForecastCache(redis)
        forecast = normalise(payload, ISTANBUL)

        assert forecast.location.cache_key != ISTANBUL.cache_key, (
            "fixture no longer exercises grid snapping"
        )

        await cache.set(ISTANBUL, forecast, days=3)
        assert list(redis.store) == [ForecastCache.key(ISTANBUL, 3)]
        assert await cache.get(ISTANBUL, days=3) is not None

    @pytest.mark.asyncio
    async def test_a_different_day_count_is_a_different_entry(
        self, payload: dict[str, Any]
    ) -> None:
        cache = ForecastCache(FakeRedis())
        await cache.set(ISTANBUL, normalise(payload, ISTANBUL), days=3)
        assert await cache.get(ISTANBUL, days=7) is None

    @pytest.mark.asyncio
    async def test_an_entry_from_an_older_shape_is_a_miss(
        self, payload: dict[str, Any]
    ) -> None:
        redis = FakeRedis()
        cache = ForecastCache(redis)
        forecast = normalise(payload, ISTANBUL)

        stale = json.loads(_encode(forecast))
        stale["v"] = CACHE_VERSION - 1
        redis.store[ForecastCache.key(ISTANBUL, 3)] = json.dumps(stale)

        assert await cache.get(ISTANBUL, days=3) is None

    @pytest.mark.asyncio
    async def test_a_corrupt_entry_is_a_miss_not_an_error(self) -> None:
        redis = FakeRedis()
        redis.store[ForecastCache.key(ISTANBUL, 3)] = "{not json"
        assert await ForecastCache(redis).get(ISTANBUL, days=3) is None

    @pytest.mark.asyncio
    async def test_redis_being_down_is_a_miss_not_an_error(
        self, payload: dict[str, Any]
    ) -> None:
        """A cache that can take the service down with it is a liability."""
        cache = ForecastCache(FakeRedis(broken=True))
        assert await cache.get(ISTANBUL, days=3) is None
        await cache.set(ISTANBUL, normalise(payload, ISTANBUL), days=3)  # must not raise

    @pytest.mark.asyncio
    async def test_works_with_no_redis_at_all(self, payload: dict[str, Any]) -> None:
        cache = ForecastCache(None)
        await cache.set(ISTANBUL, normalise(payload, ISTANBUL), days=3)
        assert await cache.get(ISTANBUL, days=3) is None


class CountingClient:
    """An OpenMeteoClient stand-in that counts calls and can be made to fail."""

    def __init__(self, forecast: Forecast, *, fail: bool = False) -> None:
        self.forecast = forecast
        self.fail = fail
        self.calls = 0

    async def fetch(self, location: Location, days: int = 7) -> Forecast:
        self.calls += 1
        if self.fail:
            raise ForecastUnavailableError("upstream is down")
        return self.forecast


class TestService:
    @pytest.mark.asyncio
    async def test_a_fresh_entry_skips_the_network(self, payload: dict[str, Any]) -> None:
        forecast = normalise(payload, ISTANBUL)
        client = CountingClient(forecast)
        cache = ForecastCache(FakeRedis())
        await cache.set(ISTANBUL, forecast, days=3)

        service = WeatherService(client, cache, ttl_seconds=600)  # type: ignore[arg-type]
        await service.get_forecast(ISTANBUL, days=3)

        assert client.calls == 0

    @pytest.mark.asyncio
    async def test_an_expired_entry_is_refetched(self, payload: dict[str, Any]) -> None:
        old = normalise(payload, ISTANBUL)
        expired = Forecast(
            location=old.location,
            hours=old.hours,
            fetched_at=datetime.now(UTC) - timedelta(hours=2),
        )
        cache = ForecastCache(FakeRedis())
        await cache.set(ISTANBUL, expired, days=3)

        client = CountingClient(old)
        service = WeatherService(client, cache, ttl_seconds=600)  # type: ignore[arg-type]
        result = await service.get_forecast(ISTANBUL, days=3)

        assert client.calls == 1
        assert result.fetched_at == old.fetched_at

    @pytest.mark.asyncio
    async def test_stale_beats_nothing_when_upstream_is_down(
        self, payload: dict[str, Any]
    ) -> None:
        """The central rule from docs/01: lose capability, not availability."""
        old = normalise(payload, ISTANBUL)
        expired = Forecast(
            location=old.location,
            hours=old.hours,
            fetched_at=datetime.now(UTC) - timedelta(hours=6),
        )
        cache = ForecastCache(FakeRedis())
        await cache.set(ISTANBUL, expired, days=3)

        service = WeatherService(CountingClient(old, fail=True), cache, ttl_seconds=600)  # type: ignore[arg-type]
        result = await service.get_forecast(ISTANBUL, days=3)

        assert result.hours == old.hours
        assert result.is_stale(600), "the caller must be able to tell this is old"

    @pytest.mark.asyncio
    async def test_upstream_down_with_a_cold_cache_raises(
        self, payload: dict[str, Any]
    ) -> None:
        """An empty forecast would render as 'no good windows', which is a worse lie."""
        service = WeatherService(
            CountingClient(normalise(payload, ISTANBUL), fail=True),  # type: ignore[arg-type]
            ForecastCache(FakeRedis()),
            ttl_seconds=600,
        )
        with pytest.raises(ForecastUnavailableError):
            await service.get_forecast(ISTANBUL, days=3)

    @pytest.mark.asyncio
    async def test_a_fetched_forecast_is_written_back(self, payload: dict[str, Any]) -> None:
        redis = FakeRedis()
        cache = ForecastCache(redis)
        service = WeatherService(CountingClient(normalise(payload, ISTANBUL)), cache, 600)  # type: ignore[arg-type]

        await service.get_forecast(ISTANBUL, days=3)
        assert ForecastCache.key(ISTANBUL, 3) in redis.store
