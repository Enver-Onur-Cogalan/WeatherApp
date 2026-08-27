"""Tests for the planning endpoint.

The weather service is replaced with a stand-in, so these exercise the HTTP contract and
the wiring — not Open-Meteo, and not the network.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_weather_service
from app.main import app
from app.weather.client import ForecastUnavailableError, normalise
from app.weather.models import Forecast, Location

FIXTURE = Path(__file__).parent / "fixtures" / "open-meteo-istanbul.json"

RUNNER: dict[str, Any] = {
    "activity": "running",
    "temp_min": 5,
    "temp_max": 26,
    "wind_max_kmh": 15,
    "precip_max_pct": 20,
    "preferred_hours": [6, 10],
    "uv_max": 6,
}

BODY: dict[str, Any] = {
    "latitude": 41.0082,
    "longitude": 28.9784,
    "timezone": "Europe/Istanbul",
    "days": 3,
    "profile": RUNNER,
}


def build_forecast(*, age: timedelta = timedelta()) -> Forecast:
    payload = json.loads(FIXTURE.read_text())
    forecast = normalise(payload, Location(41.0082, 28.9784, "Europe/Istanbul"))
    if not age:
        return forecast
    return Forecast(
        location=forecast.location,
        hours=forecast.hours,
        fetched_at=datetime.now(UTC) - age,
    )


class StubWeather:
    def __init__(self, forecast: Forecast | None, ttl_seconds: int = 600) -> None:
        self._forecast = forecast
        self.ttl_seconds = ttl_seconds
        self.requested: list[tuple[Location, int]] = []

    async def get_forecast(self, location: Location, days: int = 7) -> Forecast:
        self.requested.append((location, days))
        if self._forecast is None:
            raise ForecastUnavailableError("upstream is down")
        return self._forecast


def client_with(stub: StubWeather) -> TestClient:
    async def override() -> Any:
        yield stub

    app.dependency_overrides[get_weather_service] = override
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Any:
    yield
    app.dependency_overrides.clear()


class TestPlanEndpoint:
    def test_returns_the_trace_the_windows_and_the_blocker(self) -> None:
        with client_with(StubWeather(build_forecast())) as client:
            response = client.post("/plan", json=BODY)

        assert response.status_code == 200
        body = response.json()
        assert len(body["hours"]) == 72
        assert body["windows"], "a clear August week should have windows"
        assert set(body) == {
            "latitude",
            "longitude",
            "timezone",
            "fetched_at",
            "stale",
            "hours",
            "windows",
            "blocker",
        }

    def test_windows_arrive_ranked(self) -> None:
        with client_with(StubWeather(build_forecast())) as client:
            windows = client.post("/plan", json=BODY).json()["windows"]

        scores = [w["score"] for w in windows]
        assert scores == sorted(scores, reverse=True)

    def test_every_hour_carries_what_the_readout_needs(self) -> None:
        with client_with(StubWeather(build_forecast())) as client:
            hour = client.post("/plan", json=BODY).json()["hours"][0]

        assert set(hour) >= {
            "hour_utc",
            "local_hour",
            "score",
            "excluded",
            "temperature_c",
            "wind_kmh",
            "precip_prob_pct",
            "uv_index",
            "weather_code",
        }

    def test_the_default_horizon_applies_when_days_is_omitted(self) -> None:
        stub = StubWeather(build_forecast())
        body = {k: v for k, v in BODY.items() if k != "days"}
        with client_with(stub) as client:
            assert client.post("/plan", json=body).status_code == 200
        assert stub.requested[0][1] == 7

    def test_freshness_is_reported_not_left_to_the_client(self) -> None:
        """docs/02: a forecast without a time on it is a lie."""
        with client_with(StubWeather(build_forecast())) as client:
            fresh = client.post("/plan", json=BODY).json()
        assert fresh["stale"] is False
        assert datetime.fromisoformat(fresh["fetched_at"]).tzinfo is not None

        with client_with(StubWeather(build_forecast(age=timedelta(hours=3)))) as client:
            stale = client.post("/plan", json=BODY).json()
        assert stale["stale"] is True

    def test_a_different_profile_reshapes_the_same_week(self) -> None:
        """The product's thesis, asserted: the trace is per activity, not per place."""
        evening = {**RUNNER, "preferred_hours": [18, 21]}
        with client_with(StubWeather(build_forecast())) as client:
            morning_windows = client.post("/plan", json=BODY).json()["windows"]
            evening_windows = client.post("/plan", json={**BODY, "profile": evening}).json()[
                "windows"
            ]

        assert morning_windows != evening_windows
        assert morning_windows[0]["start_hour"] != evening_windows[0]["start_hour"]


class TestPlanEndpointRejects:
    def test_an_unreachable_forecast_with_nothing_cached(self) -> None:
        """503, never an empty plan.

        An empty plan renders as "no good windows this week" — a claim about the
        weather, when the truth is that we could not reach the forecast service.
        """
        with client_with(StubWeather(None)) as client:
            response = client.post("/plan", json=BODY)

        assert response.status_code == 503
        assert "windows" not in response.json()

    def test_an_inverted_temperature_range(self) -> None:
        body = {**BODY, "profile": {**RUNNER, "temp_min": 30, "temp_max": 10}}
        with client_with(StubWeather(build_forecast())) as client:
            response = client.post("/plan", json=body)
        assert response.status_code == 422

    def test_an_unknown_activity(self) -> None:
        body = {**BODY, "profile": {**RUNNER, "activity": "quidditch"}}
        with client_with(StubWeather(build_forecast())) as client:
            assert client.post("/plan", json=body).status_code == 422

    def test_an_out_of_range_coordinate(self) -> None:
        with client_with(StubWeather(build_forecast())) as client:
            assert client.post("/plan", json={**BODY, "latitude": 91.0}).status_code == 422

    def test_an_unexpected_field(self) -> None:
        """The schema forbids extras, so a typo fails loudly instead of being ignored."""
        with client_with(StubWeather(build_forecast())) as client:
            response = client.post("/plan", json={**BODY, "timezome": "Europe/Istanbul"})
        assert response.status_code == 422
