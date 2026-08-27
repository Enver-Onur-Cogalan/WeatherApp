"""The planning endpoint.

One request returns everything the trace screen draws: the scored hours, the ranked
windows, and the constraint that closed the rest. No language model is involved —
this is the deterministic path (docs/06), and it is the one most requests take.

The profile arrives inline. Once profiles are stored per account this becomes a `GET`
with a profile id, which is cacheable and shorter; sending it in a body is the honest
shape while there is nowhere to store one.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.deps import WeatherDep
from app.core.logging import get_logger
from app.planning.daily import current_index, summarise_days
from app.planning.models import Activity, ActivityProfile
from app.planning.scoring import plan as run_plan
from app.planning.scoring import score_hours
from app.schemas.plan_request import PlanRequest
from app.schemas.plan_result import Blocker, DaySummary, PlanResult, ScoredHour, Window
from app.weather.client import ForecastUnavailableError
from app.weather.models import Location

logger = get_logger(__name__)
router = APIRouter(tags=["planning"])

DEFAULT_DAYS = 7


def _to_domain(request: PlanRequest) -> ActivityProfile:
    """The wire profile into the engine's own type.

    Two representations on purpose: the wire shape is generated from JSON Schema and is
    also what the model is constrained to, while the engine's type is frozen, slotted,
    and free of Pydantic. Converting here keeps `planning` importable with nothing else
    installed.
    """
    profile = request.profile
    start, end = profile.preferred_hours
    return ActivityProfile(
        activity=Activity(profile.activity),
        temp_min=profile.temp_min,
        temp_max=profile.temp_max,
        wind_max_kmh=profile.wind_max_kmh,
        precip_max_pct=profile.precip_max_pct,
        preferred_hours=(start, end),
        uv_max=profile.uv_max,
    )


@router.post(
    "/plan",
    response_model=PlanResult,
    summary="When to go outside",
    responses={
        503: {"description": "The forecast could not be retrieved and nothing was cached"},
    },
)
async def create_plan(request: PlanRequest, weather: WeatherDep) -> PlanResult:
    # JSON Schema can bound each field but not relate two of them, so the one
    # cross-field rule lives here rather than in the generated model.
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
    days = request.days or DEFAULT_DAYS

    try:
        forecast = await weather.get_forecast(location, days=days)
    except ForecastUnavailableError as exc:
        # 503 rather than an empty result: an empty plan renders as "no good windows
        # this week", which is a different and much worse claim than "we could not
        # reach the forecast service" (docs/01).
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Forecast unavailable and nothing cached for this location",
        ) from exc

    profile = _to_domain(request)
    hours = list(forecast.hours)
    scored = score_hours(hours, profile)
    windows, blocker = run_plan(hours, profile)

    return PlanResult(
        latitude=forecast.location.latitude,
        longitude=forecast.location.longitude,
        timezone=forecast.location.timezone,
        fetched_at=forecast.fetched_at.isoformat(),
        stale=forecast.is_stale(weather.ttl_seconds),
        hours=[
            ScoredHour(
                hour_utc=item.hour.hour_utc.isoformat(),
                local_hour=item.hour.local_hour,
                score=round(item.score, 1),
                excluded=item.excluded,
                worst_penalty=item.worst_penalty,
                temperature_c=item.hour.temperature_c,
                precip_prob_pct=item.hour.precip_prob_pct,
                wind_kmh=item.hour.wind_kmh,
                uv_index=item.hour.uv_index,
                cloud_cover_pct=item.hour.cloud_cover_pct,
                weather_code=item.hour.weather_code,
            )
            for item in scored
        ],
        windows=[
            Window(
                day=window.day,
                start_hour=window.start_hour,
                end_hour=window.end_hour,
                score=round(window.mean_score, 1),
                length_hours=window.length_hours,
            )
            for window in windows
        ],
        days=[
            DaySummary(
                date=day.date,
                temp_min_c=round(day.temp_min_c, 1),
                temp_max_c=round(day.temp_max_c, 1),
                weather_code=day.weather_code,
                precip_prob_max_pct=day.precip_prob_max_pct,
            )
            for day in summarise_days(hours)
        ],
        # Resolved here so no screen has to work out what "now" means in the location's
        # timezone, which is a different question from what it means on the device.
        now_index=current_index(hours),
        blocker=Blocker(constraint=blocker[0], hours=blocker[1]) if blocker else None,
    )
