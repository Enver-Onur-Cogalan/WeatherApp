"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class AgentAnswer(BaseModel):
    """What the language model is asked to produce, which is deliberately less than the API returns. The window itself is a computed fact and comes from the scoring engine; letting the model emit one invited it to name a window nobody had ranked. The model contributes the judgement and the sentence, and nothing that can be calculated."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["good", "mixed", "bad"] = Field(
        description='How good the best window is for this profile, or null when the question was not asking for a judgement. "Yarın kaç derece olacak?" wants a temperature; forcing a verdict onto it made the model pick one at random, and the coherence gate correctly rejected the result.'
    )
    reason: str = Field(
        min_length=1,
        max_length=400,
        description="One or two sentences explaining the verdict, in the language the question was asked in. Cite only figures that appear in the tool results.",
    )
    warnings: list[Annotated[str, StringConstraints(max_length=200)]] = Field(
        max_length=4,
        description="Conditions worth flagging even when the verdict is good. Empty when there are none. Never mention weather that is not in the tool results.",
    )
    window_index: int | None = Field(
        ge=0,
        le=4,
        description="Which of the ranked windows the answer is about, counting from 0 in the order they were listed, or null when the answer is not about a window. The model picks; the engine supplies every figure (ADR-0007). Before this existed the engine's own best window was attached to every answer, so asking about the weekend produced a card showing Monday.",
    )
