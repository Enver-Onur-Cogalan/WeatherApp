"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AgentAnswer(BaseModel):
    """What the language model is asked to produce, which is deliberately less than the API returns. The window itself is a computed fact and comes from the scoring engine; letting the model emit one invited it to name a window nobody had ranked. The model contributes the judgement and the sentence, and nothing that can be calculated."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["good", "mixed", "bad"] = Field(
        description="Whether the conditions suit the activity."
    )
    reason: str = Field(
        min_length=1,
        max_length=400,
        description="One or two sentences explaining the verdict, in the language the question was asked in. Cite only figures that appear in the tool results.",
    )
    warnings: list[str] = Field(
        max_length=4,
        description="Conditions worth flagging even when the verdict is good. Empty when there are none. Never mention weather that is not in the tool results.",
    )
