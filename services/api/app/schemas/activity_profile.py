"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ActivityProfile(BaseModel):
    """What a person wants from the weather before they will go outside. Extracted from natural language once, confirmed by the user, then read by the scoring engine on every request."""

    model_config = ConfigDict(extra="forbid")

    activity: Literal[
        "running",
        "cycling",
        "walking",
        "picnic",
        "photography",
        "gardening",
        "swimming",
        "other",
    ] = Field(description="What the person does outdoors, in one lowercase word.")
    temp_min: int = Field(
        ge=-40, le=50, description="Coldest acceptable temperature in Celsius."
    )
    temp_max: int = Field(
        ge=-40, le=50, description="Warmest acceptable temperature in Celsius."
    )
    wind_max_kmh: int = Field(
        ge=0, le=150, description="Highest acceptable wind speed in km/h."
    )
    precip_max_pct: int = Field(
        ge=0, le=100, description="Highest acceptable chance of precipitation, as a percentage."
    )
    uv_max: int | None = Field(
        default=None,
        ge=0,
        le=15,
        description="Highest acceptable UV index, or null if the person did not say.",
    )
    preferred_hours: list[int] = Field(
        min_length=2,
        max_length=2,
        description="The hours of day the person prefers, as [start, end] in local time. Without this term the engine ranks 03:00 as the best hour of the week.",
    )
