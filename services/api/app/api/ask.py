"""The assistant endpoint.

The tier most requests do not take. The trace screen answers the common questions
deterministically and in milliseconds; this is the escape hatch for the ones it cannot,
and it is deliberately not the front door (ADR-0014, docs/06).

It always answers. The agent falls back to the scoring engine when the model is
unreachable, asks for nothing, or produces something that fails validation — so the only
error this endpoint can return is a forecast it could not retrieve at all.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.agent.orchestrator import AgentAnswer
from app.api.plan import DEFAULT_DAYS, to_domain_profile
from app.core.deps import AgentDep, WeatherDep
from app.core.logging import get_logger
from app.schemas.ask_request import AskRequest
from app.schemas.ask_response import AskResponse
from app.weather.client import ForecastUnavailableError
from app.weather.models import Location

logger = get_logger(__name__)
router = APIRouter(tags=["assistant"])


@router.post(
    "/ask",
    response_model=AskResponse,
    summary="Ask the assistant a question",
    responses={
        503: {"description": "The forecast could not be retrieved and nothing was cached"},
    },
)
async def ask(request: AskRequest, weather: WeatherDep, agent: AgentDep) -> AskResponse:
    if request.profile.temp_min > request.profile.temp_max:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="temp_min must not be above temp_max",
        )

    location = Location(
        latitude=request.latitude,
        longitude=request.longitude,
        timezone=request.timezone,
    )

    try:
        forecast = await weather.get_forecast(location, days=request.days or DEFAULT_DAYS)
    except ForecastUnavailableError as exc:
        # The only failure that reaches the client. A missing model is degraded, not
        # down — a missing forecast leaves nothing to be right about.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Forecast unavailable and nothing cached for this location",
        ) from exc

    answer: AgentAnswer = await agent.answer(
        request.question, list(forecast.hours), to_domain_profile(request.profile)
    )

    logger.info(
        "ask.answered",
        from_model=not answer.fell_back,
        tools=len(answer.tool_calls),
        duration_ms=answer.duration_ms,
    )

    return AskResponse(
        answer=answer.response,
        tool_calls=list(answer.tool_calls),
        duration_ms=answer.duration_ms,
        from_model=not answer.fell_back,
        fallback_reason=answer.fallback_reason or None,
        # Stated rather than assumed. The model is local by construction (ADR-0004), and
        # the interface says so instead of leaving the user to wonder.
        on_device=True,
    )
