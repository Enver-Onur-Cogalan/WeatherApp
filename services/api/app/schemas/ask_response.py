"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from .plan_response import PlanResponse


class AskResponse(BaseModel):
    """The assistant's answer, and how it was produced. The provenance is not diagnostics: the interface shows it (docs/11), because an assistant that runs on your own device should say so, and an answer the model did not write should not be presented as though it had."""

    model_config = ConfigDict(extra="forbid")

    answer: PlanResponse = Field(
        description="The assistant's answer to a planning question. Every figure in it comes from the scoring engine; the model supplies the sentence, not the facts."
    )
    tool_calls: list[str] = Field(
        description="Tools the model asked for, in order. Empty when it asked for none."
    )
    duration_ms: int = Field(ge=0)
    from_model: bool = Field(
        description="False when the answer came from the scoring engine instead — because the model was unreachable, asked for nothing, or produced something that failed validation. The answer is still correct; it is just not the model's sentence."
    )
    fallback_reason: str | None = Field(
        default=None, description="Why the engine answered instead. Null when the model did."
    )
    on_device: bool = Field(
        description="Always true. The model is local by construction (ADR-0004), and the interface states it rather than leaving the user to assume."
    )
