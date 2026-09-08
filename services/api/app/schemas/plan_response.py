"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: str = Field(description="Local date as YYYY-MM-DD.")
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    score: float = Field(
        ge=0, le=100, description="Mean comfort score across the window, 0 to 100."
    )
    temp_min_c: float | None = Field(
        default=None,
        ge=-90,
        le=60,
        description="Coldest hour in the window. Computed by the scoring engine and attached to the answer — the model never produces a figure a person reads (ADR-0007).",
    )
    temp_max_c: float | None = Field(
        default=None, ge=-90, le=60, description="Warmest hour in the window."
    )
    wind_max_kmh: float | None = Field(
        default=None, ge=0, le=300, description="Strongest wind in the window."
    )
    precip_prob_max_pct: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Highest chance of precipitation across the window.",
    )
    weather_code: int | None = Field(
        default=None,
        ge=0,
        le=99,
        description="The most severe WMO code in the window — what the interface names the conditions from.",
    )


class PlanResponse(BaseModel):
    """The assistant's answer to a planning question. Every figure in it comes from the scoring engine; the model supplies the sentence, not the facts."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["good", "mixed", "bad"] | None = Field(
        description='How good the best window is for this profile, or null when the question was not asking for a judgement. "Yarın kaç derece olacak?" wants a temperature; forcing a verdict onto it made the model pick one at random, and the coherence gate correctly rejected the result.'
    )
    best_window: Window | None = Field(default=None)
    reason: str = Field(
        min_length=1,
        max_length=400,
        description="One or two sentences explaining the verdict, in the language the question was asked in.",
    )
    warnings: list[Annotated[str, StringConstraints(max_length=200)]] = Field(
        max_length=4,
        description="Conditions worth flagging even when the verdict is good. Empty when there are none.",
    )
