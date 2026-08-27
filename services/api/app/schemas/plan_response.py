"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day: str = Field(description="Local date as YYYY-MM-DD.")
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)
    score: float = Field(ge=0, le=100, description="Mean comfort score across the window, 0 to 100.")

class PlanResponse(BaseModel):
    """The assistant's answer to a planning question. Every figure in it comes from the scoring engine; the model supplies the sentence, not the facts."""
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["good", "mixed", "bad"] = Field(description="Whether the conditions suit the activity.")
    best_window: Window | None = Field(default=None)
    reason: str = Field(min_length=1, max_length=400, description="One or two sentences explaining the verdict, in the language the question was asked in.")
    warnings: list[str] = Field(max_length=4, description="Conditions worth flagging even when the verdict is good. Empty when there are none.")
