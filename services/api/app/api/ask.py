"""The assistant endpoint.

The tier most requests do not take. The trace screen answers the common questions
deterministically and in milliseconds; this is the escape hatch for the ones it cannot,
and it is deliberately not the front door (ADR-0014, docs/06).

It always answers. The agent falls back to the scoring engine when the model is
unreachable, asks for nothing, or produces something that fails validation — so the only
error this endpoint can return is a forecast it could not retrieve at all.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

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
    location, days = _validated(request)

    try:
        forecast = await weather.get_forecast(location, days=days)
    except ForecastUnavailableError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Forecast unavailable and nothing cached for this location",
        ) from exc

    answer: AgentAnswer = await agent.answer(
        request.question, list(forecast.hours), to_domain_profile(request.profile)
    )

    logger.info(
        "ask.answered",
        streamed=False,
        from_model=not answer.fell_back,
        tools=len(answer.tool_calls),
        duration_ms=answer.duration_ms,
    )

    return _response(answer)


def _validated(request: AskRequest) -> tuple[Location, int]:
    """The one cross-field rule, and the location, shared by both handlers.

    Extracted when the streaming endpoint arrived rather than copied. Two endpoints
    answering the same question with two copies of the validation is how one of them ends
    up accepting something the other rejects.
    """
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
    return location, request.days or DEFAULT_DAYS


def _response(answer: AgentAnswer) -> AskResponse:
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


@router.post(
    "/ask/stream",
    summary="Ask the assistant, and hear what it is doing",
    responses={
        200: {
            "content": {"application/x-ndjson": {}},
            "description": "One JSON object per line: phases, then the answer.",
        },
        503: {"description": "The forecast could not be retrieved and nothing was cached"},
    },
)
async def ask_stream(
    request: AskRequest, weather: WeatherDep, agent: AgentDep
) -> StreamingResponse:
    """The same answer, with the wait explained.

    A median question takes forty seconds on this hardware (docs/08), which is a long time
    to show nothing. The phases streamed here are the ones the agent actually goes
    through — there is no progress fraction, because the agent does not know one and a
    made-up bar would be the fiction docs/13 ruled out when this was D1's sibling problem.

    Newline-delimited JSON rather than Server-Sent Events. SSE buys reconnection and event
    ids, neither of which apply to a single request that is worthless if resumed halfway;
    NDJSON is a line per event and needs no parser.
    """
    location, days = _validated(request)

    try:
        forecast = await weather.get_forecast(location, days=days)
    except ForecastUnavailableError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Forecast unavailable and nothing cached for this location",
        ) from exc

    async def events() -> AsyncIterator[bytes]:
        # The agent reports phases from inside one await, so they are queued rather than
        # yielded — the generator drains the queue while the answer is still being made.
        queue: asyncio.Queue[str] = asyncio.Queue()
        task = asyncio.create_task(
            agent.answer(
                request.question,
                list(forecast.hours),
                to_domain_profile(request.profile),
                on_phase=queue.put_nowait,
            )
        )

        while not task.done() or not queue.empty():
            try:
                phase = await asyncio.wait_for(queue.get(), timeout=0.25)
            except TimeoutError:
                # Nothing new to say. The loop comes back to check whether the answer has
                # landed rather than blocking on a queue that may never fill again.
                continue
            yield _line({"phase": phase})

        answer = await task
        logger.info(
            "ask.answered",
            streamed=True,
            from_model=not answer.fell_back,
            tools=len(answer.tool_calls),
            duration_ms=answer.duration_ms,
        )
        yield _line({"phase": "done", "answer": _response(answer).model_dump(mode="json")})

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        # Without this a reverse proxy may buffer the whole response and deliver the
        # phases with the answer, which is exactly no better than not streaming.
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
    )


def _line(payload: dict[str, object]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode()
