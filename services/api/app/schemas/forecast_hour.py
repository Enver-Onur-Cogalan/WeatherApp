"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ForecastHour(BaseModel):
    """One normalised hour of forecast. Canonical units only: Celsius, km/h, millimetres, UTC."""

    model_config = ConfigDict(extra="forbid")

    hour_utc: str = Field(description="Authoritative timestamp, always UTC.")
    local_hour: int = Field(
        ge=0,
        le=23,
        description="Hour of day in the location's timezone. Denormalised because every query needs it.",
    )
    temperature_c: float
    precip_prob_pct: int = Field(ge=0, le=100)
    precip_mm: float = Field(ge=0)
    wind_kmh: float = Field(ge=0)
    uv_index: float = Field(ge=0)
    cloud_cover_pct: int = Field(ge=0, le=100)
    weather_code: int = Field(
        description="WMO code. The source of truth for which atmosphere state renders — precipitation and cloud cover alone cannot tell snow from rain."
    )
