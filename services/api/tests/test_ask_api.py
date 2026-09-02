"""Tests for the assistant endpoint.

Both the weather service and the agent are replaced, so these exercise the HTTP contract
and the wiring rather than Open-Meteo or a model. What the real model does with a real
question is measured by running it, not asserted here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agent.orchestrator import AgentAnswer
from app.core.deps import get_agent, get_weather_service
from app.main import app
from app.planning.models import ActivityProfile, ForecastHour
from app.schemas.plan_response import PlanResponse
from app.schemas.plan_response import Window as ResponseWindow
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
    "question": "Bu hafta koşu için en iyi zaman ne zaman?",
}


def build_forecast() -> Forecast:
    payload = json.loads(FIXTURE.read_text())
    return normalise(payload, Location(41.0082, 28.9784, "Europe/Istanbul"))


class StubWeather:
    def __init__(self, forecast: Forecast | None) -> None:
        self._forecast = forecast
        self.ttl_seconds = 600

    async def get_forecast(self, location: Location, days: int = 7) -> Forecast:
        if self._forecast is None:
            raise ForecastUnavailableError("upstream is down")
        return self._forecast


class StubAgent:
    """Returns a fixed answer and records the question and hours it was handed."""

    def __init__(self, answer: AgentAnswer) -> None:
        self._answer = answer
        self.asked: list[str] = []
        self.hours_seen = 0

    async def answer(
        self, question: str, hours: list[ForecastHour], profile: ActivityProfile
    ) -> AgentAnswer:
        self.asked.append(question)
        self.hours_seen = len(hours)
        return self._answer


def an_answer(*, fell_back: bool = False, reason: str = "") -> AgentAnswer:
    return AgentAnswer(
        response=PlanResponse(
            verdict="good",
            best_window=ResponseWindow(day="2026-08-27", start_hour=6, end_hour=11, score=95.2),
            reason="Sabah 06:00–11:00 arası uygun.",
            warnings=[],
        ),
        tool_calls=("get_activity_windows",),
        duration_ms=1900,
        fell_back=fell_back,
        fallback_reason=reason,
    )


def client_with(weather: StubWeather, agent: StubAgent) -> TestClient:
    async def weather_override() -> Any:
        yield weather

    async def agent_override() -> Any:
        yield agent

    app.dependency_overrides[get_weather_service] = weather_override
    app.dependency_overrides[get_agent] = agent_override
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Any:
    yield
    app.dependency_overrides.clear()


class TestAsk:
    def test_returns_the_answer_and_how_it_was_produced(self) -> None:
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            response = client.post("/ask", json=BODY)

        assert response.status_code == 200
        body = response.json()
        assert body["answer"]["reason"]
        assert body["tool_calls"] == ["get_activity_windows"]
        assert body["duration_ms"] == 1900
        assert body["from_model"] is True
        assert body["on_device"] is True

    def test_the_question_reaches_the_agent_unchanged(self) -> None:
        """In the user's own words and language — nothing normalises it on the way."""
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            client.post("/ask", json=BODY)
        assert agent.asked == [BODY["question"]]

    def test_the_agent_is_handed_the_retrieved_forecast(self) -> None:
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            client.post("/ask", json=BODY)
        assert agent.hours_seen == 72

    def test_an_engine_answer_says_so_rather_than_passing_as_the_model(self) -> None:
        """docs/11 shows provenance, so an answer the model did not write is labelled."""
        agent = StubAgent(an_answer(fell_back=True, reason="assistant unreachable"))
        with client_with(StubWeather(build_forecast()), agent) as client:
            body = client.post("/ask", json=BODY).json()

        assert body["from_model"] is False
        assert body["fallback_reason"] == "assistant unreachable"
        assert body["answer"]["best_window"], "and it is still a real answer"

    def test_fallback_reason_is_null_when_the_model_answered(self) -> None:
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            assert client.post("/ask", json=BODY).json()["fallback_reason"] is None

    def test_the_default_horizon_applies_when_days_is_omitted(self) -> None:
        agent = StubAgent(an_answer())
        body = {k: v for k, v in BODY.items() if k != "days"}
        with client_with(StubWeather(build_forecast()), agent) as client:
            assert client.post("/ask", json=body).status_code == 200


class TestAskRejects:
    def test_an_unreachable_forecast_with_nothing_cached(self) -> None:
        """The only failure that reaches the client.

        A missing model is degraded — the agent falls back and still answers. A missing
        forecast leaves nothing to be right about.
        """
        agent = StubAgent(an_answer())
        with client_with(StubWeather(None), agent) as client:
            assert client.post("/ask", json=BODY).status_code == 503

    def test_an_empty_question(self) -> None:
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            assert client.post("/ask", json={**BODY, "question": ""}).status_code == 422

    def test_an_inverted_temperature_range(self) -> None:
        agent = StubAgent(an_answer())
        body = {**BODY, "profile": {**RUNNER, "temp_min": 30, "temp_max": 10}}
        with client_with(StubWeather(build_forecast()), agent) as client:
            assert client.post("/ask", json=body).status_code == 422

    def test_an_unexpected_field(self) -> None:
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            response = client.post("/ask", json={**BODY, "quesiton": "typo"})
        assert response.status_code == 422


class TestReadyReportsTheAssistant:
    def test_the_assistant_is_reported_separately_from_the_service(self) -> None:
        """A missing model is degraded, not down — the app works without it."""
        agent = StubAgent(an_answer())
        with client_with(StubWeather(build_forecast()), agent) as client:
            body = client.get("/ready").json()
        assert set(body) == {"status", "assistant", "model"}
        assert body["status"] in {"ready", "degraded"}
