"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .activity_profile import ActivityProfile


class PlanRequest(BaseModel):
    """Ask the scoring engine when to go outside. The profile is sent inline for now; once profiles are stored per account this becomes a reference to a saved one."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str = Field(
        min_length=1,
        description="IANA name, e.g. Europe/Istanbul. Never a fixed offset — that breaks twice a year.",
    )
    days: int | None = Field(default=None, ge=1, le=16, description="Forecast horizon in days.")
    profile: ActivityProfile = Field(
        description="What a person wants from the weather before they will go outside. Extracted from natural language once, confirmed by the user, then read by the scoring engine on every request."
    )
