"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .activity_profile import ActivityProfile


class AskRequest(BaseModel):
    """An open-ended question for the assistant. This is the tier most requests do not take — the trace screen answers the common ones deterministically, and this is the escape hatch for what it cannot (docs/06)."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    timezone: str = Field(min_length=1, description="IANA name. Never a fixed offset.")
    days: int | None = Field(default=None, ge=1, le=16)
    profile: ActivityProfile = Field(
        description="What a person wants from the weather before they will go outside. Extracted from natural language once, confirmed by the user, then read by the scoring engine on every request."
    )
    question: str = Field(
        min_length=1,
        max_length=500,
        description="What the person asked, in their own words and language.",
    )
    history: list[dict[str, object]] | None = Field(
        default=None,
        max_length=2,
        description='The last few exchanges, oldest first, so a follow-up has something to refer to. Two at most: "neden?" needs one, and more turns the escape hatch into a chat app, which ADR-0014 decided against.',
    )
    language: Literal["tr", "en"] | None = Field(
        default=None,
        description="Which language to answer in. The app sends what the person chose in settings; omitted, the server infers it from the question, which it used to do always and which drifted — the model was asked to match the question's language and nothing checked that it had.",
    )
