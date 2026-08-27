"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ScoredHour(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hour_utc: str
    local_hour: int = Field(ge=0, le=23)
    score: float = Field(ge=0, le=100)
    excluded: bool = Field(description="Severe weather removed this hour outright, regardless of profile.")
    worst_penalty: str | None = Field(default=None, description="Which constraint cost this hour the most, for explaining a low score without inventing a reason.")
    temperature_c: float
    precip_prob_pct: int
    wind_kmh: float
    uv_index: float
    cloud_cover_pct: int
    weather_code: int

class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: str
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    score: float = Field(ge=0, le=100)
    length_hours: int = Field(ge=1)

class Blocker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    constraint: str = Field(description="temperature, wind, precipitation, uv, or severe_weather. Never time_of_day — that is not weather.")
    hours: int = Field(ge=1)

class PlanResult(BaseModel):
    """Everything the trace screen needs in one response: the scored hours it draws, the windows it ranks, and the constraint that closed the rest. No language model is involved in producing any of it."""
    model_config = ConfigDict(extra="forbid")

    latitude: float
    longitude: float
    timezone: str
    fetched_at: str = Field(description="When the forecast was retrieved. The client is required to show this — a forecast without a time on it is a lie.")
    stale: bool = Field(description="True when this was served from an expired cache because the upstream was unreachable.")
    hours: list[ScoredHour] = Field(description="Every scored hour, in order. This is the trace.")
    windows: list[Window] = Field(description="Contiguous runs that clear the threshold, best first.")
    blocker: Blocker | None = Field(default=None)
