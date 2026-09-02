"""The planning agent.

Two phases, deliberately separate (ADR-0006). Measured on this project's own model,
declaring tools and applying a schema in one request drops tool calling from 75% to
**zero** across every run — not degraded, gone. So:

    Phase 1   tools declared, no schema      the model gathers what it needs
    Phase 2   schema constrained, no tools   the model fills a fixed structure

The model interprets and phrases. It never computes: every figure it is given came from
the scoring engine, and the groundedness gate afterwards rejects any figure that did not
(ADR-0007).

Nothing here can fail into silence. A model that is unreachable, that returns nothing
usable twice, or that answers with invented numbers all land on the same templated
answer built from the engine — less fluent, still correct, and the user is never told
that something went wrong when we have a perfectly good answer.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.agent.provider import Completion, Message, ModelUnavailableError, Provider
from app.agent.tools import (
    TOOL_NAMES,
    TOOLS,
    Facts,
    ToolResult,
    ToolRunner,
    blocker_facts,
    merge,
)
from app.agent.validation import (
    coherent,
    conditions_grounded,
    grounded,
    in_scope,
    parse,
    repair_prompt,
    weekdays_grounded,
)
from app.core.logging import get_logger
from app.planning.daily import local_date
from app.planning.models import ActivityProfile, ForecastHour
from app.planning.scoring import plan
from app.schemas.agent_answer import AgentAnswer as ModelAnswer
from app.schemas.plan_response import PlanResponse
from app.schemas.plan_response import Window as ResponseWindow

logger = get_logger(__name__)

MAX_TOOL_ROUNDS = 2
"""How many times the model may call tools before we stop asking.

Two is not a compromise between correctness and cost. A 4B model that has not gathered
what it needs in two rounds is looping, and a third round produces the same call again.
"""

SYSTEM = (
    "You are a weather planning assistant. You have no weather data of your own. "
    "You MUST call a tool before answering — call get_activity_windows unless another "
    "tool fits better. Never answer from memory, and never invent a number: every "
    "figure you state must come from a tool result. Always answer in the same language "
    "as the question."
)
"""Phase one's prompt, and the single largest lever measured on this agent.

"Use the tools to gather facts" produced a tool call on 1 of 4 questions. Telling the
model it *has no data of its own* and must call something produced 4 of 4 — same model,
same tools, same questions. The 75% in docs/05 was measured with a neutral prompt and is
not a fixed property of the model; a large part of what looked like weak tool calling
was the prompt declining to insist.
"""

STRUCTURE = (
    "Answer using only the tool results above. Be specific: name the day and the hours, "
    "and cite figures from the results. Do not mention weather that is not in them. "
    "One or two sentences, in the same language as the question. Reply with JSON."
)

NOTHING_GATHERED = (
    "(no tool results — answer only if the question can be answered without data)"
)


def _fold(question: str, results: list[tuple[str, str]]) -> str:
    """Question, tool results and instruction as one user message.

    Measured rather than assumed. Handing results back as `role: "tool"` messages is the
    documented shape and Ollama accepts it, but Gemma 4 does not attend to them: asked
    the same question with the same results, it answered "no specific information was
    provided". Split across two user messages it saw the data but drifted into English
    on a Turkish question. Folded into one message it saw the data and kept the language.

    Three shapes, one that works. Worth writing down because the failure is silent — the
    request succeeds and the model simply answers as though it had been given nothing.
    """
    body = "\n\n".join(f"Tool result ({name}):\n{payload}" for name, payload in results)
    return f"{question}\n\n{body or NOTHING_GATHERED}\n\n{STRUCTURE}"


@dataclass(frozen=True, slots=True)
class AgentAnswer:
    """What the agent produced, and how it got there.

    `provenance` is shown in the interface (docs/11): how many tools ran, how long it
    took, and that it happened on this device. A local-only assistant should say so.
    """

    response: PlanResponse
    tool_calls: tuple[str, ...]
    duration_ms: int
    fell_back: bool
    fallback_reason: str = ""


@dataclass
class PlanningAgent:
    provider: Provider
    max_tool_rounds: int = MAX_TOOL_ROUNDS
    _tools: list[dict[str, Any]] = field(default_factory=lambda: TOOLS)

    async def answer(
        self, question: str, hours: list[ForecastHour], profile: ActivityProfile
    ) -> AgentAnswer:
        started = time.perf_counter()
        runner = ToolRunner(hours, profile)
        # Figures the engine stands behind regardless of which tools the model chose,
        # so a correct answer is not rejected for citing one the model never asked for.
        facts: Facts = blocker_facts(hours, profile)
        called: list[str] = []

        def elapsed() -> int:
            return int((time.perf_counter() - started) * 1000)

        try:
            gathered = await self._gather(question, runner, facts, called)
        except ModelUnavailableError as exc:
            logger.warning("agent.model_unavailable", error=str(exc))
            return self._fallback(hours, profile, elapsed(), "assistant unreachable", called)

        # Ranked by the engine, before the model says anything about them.
        ranked, _ = plan(hours, profile)
        window = (
            ResponseWindow(
                day=ranked[0].day,
                start_hour=ranked[0].start_hour,
                end_hour=ranked[0].end_hour,
                score=round(ranked[0].mean_score, 1),
            )
            if ranked
            else None
        )
        codes = {hour.weather_code for hour in hours}
        dates = {local_date(hour) for hour in hours}

        if not gathered:
            # The model asked for nothing, so it has nothing to add over the engine.
            # Composing anyway produced answers like "no tool results were provided",
            # which is honest and useless — the deterministic path already has the
            # answer, and this is routing rather than failure (docs/06).
            return self._fallback(hours, profile, elapsed(), "no tools were called", called)

        try:
            answer = await self._compose(
                question, gathered, facts, codes, dates, window, elapsed, called
            )
        except ModelUnavailableError as exc:
            logger.warning("agent.model_unavailable", error=str(exc))
            return self._fallback(hours, profile, elapsed(), "assistant unreachable", called)

        if answer is not None:
            return answer
        return self._fallback(hours, profile, elapsed(), "answer failed validation", called)

    # ------------------------------------------------------------------ phase one

    async def _gather(
        self,
        question: str,
        runner: ToolRunner,
        facts: Facts,
        called: list[str],
    ) -> list[tuple[str, str]]:
        """Let the model choose tools, and run what it chose.

        No schema is applied here. That is the entire point of the phase split, and the
        constraint tax measurement is what it rests on.
        """
        messages = [Message("system", SYSTEM), Message("user", question)]
        results: list[tuple[str, str]] = []

        for round_index in range(self.max_tool_rounds):
            # Thinking stays off. Measured at twenty times the latency (docs/05), and on
            # a second tool round it cost 85 seconds for an answer no better than the
            # first — the budget buys nothing at 4B on a task this shaped.
            completion: Completion = await self.provider.call_tools(
                messages, self._tools, think=False
            )

            if not completion.called_tools:
                # Silence, not a wrong tool. The engine's own results still reach phase
                # two, so an answer is still possible — it is just less specific.
                logger.debug("agent.no_tool_call", round=round_index)
                break

            for call in completion.tool_calls:
                if call.name not in TOOL_NAMES:
                    logger.warning("agent.unknown_tool", name=call.name)
                    continue
                result: ToolResult = runner.run(call.name, call.arguments)
                merge(facts, result.facts)
                called.append(call.name)
                results.append((call.name, result.as_text()))
                # Fed back as user text for the same reason phase two folds them: the
                # model does not read `role: "tool"`.
                messages.append(
                    Message("user", f"Tool result ({call.name}):\n{result.as_text()}")
                )

        return results

    # ------------------------------------------------------------------ phase two

    async def _compose(
        self,
        question: str,
        gathered: list[tuple[str, str]],
        facts: Facts,
        codes: set[int],
        dates: set[str],
        window: ResponseWindow | None,
        elapsed: Any,
        called: list[str],
    ) -> AgentAnswer | None:
        """Constrained decoding into the response schema, with one repair attempt.

        The retry is fed the specific figures that failed rather than a generic
        complaint, which is the difference between a retry that can succeed and one that
        repeats itself.
        """
        # The model fills judgement and prose only. `best_window` is attached from the
        # engine afterwards — an earlier version let the model emit one, and it answered
        # with `best_window: null` while the engine had ranked seven (ADR-0007).
        schema = ModelAnswer.model_json_schema()
        messages = [Message("system", SYSTEM), Message("user", _fold(question, gathered))]

        for attempt in range(2):
            completion = await self.provider.structured(messages, schema, think=False)
            response = parse(completion.text)

            if response is None:
                logger.warning("agent.unparseable", attempt=attempt)
                messages.append(
                    Message("user", "Your previous reply was not valid JSON. Answer again.")
                )
                continue

            checks = (
                in_scope(response),
                coherent(response, window),
                grounded(response, facts),
                conditions_grounded(response, codes),
                weekdays_grounded(response, dates),
            )
            for verdict in checks:
                if not verdict.ok:
                    logger.warning("agent.rejected", attempt=attempt, reason=verdict.reason)
                    messages.append(Message("user", repair_prompt(verdict)))
                    break
            else:
                return AgentAnswer(
                    response=PlanResponse(
                        verdict=response.verdict,
                        best_window=window,
                        reason=response.reason,
                        warnings=response.warnings,
                    ),
                    tool_calls=tuple(called),
                    duration_ms=elapsed(),
                    fell_back=False,
                )

        return None

    # ------------------------------------------------------------------ fallback

    def _fallback(
        self,
        hours: list[ForecastHour],
        profile: ActivityProfile,
        duration_ms: int,
        reason: str,
        called: list[str],
    ) -> AgentAnswer:
        """The engine's own answer, in a sentence.

        Built entirely from the scoring engine, so it is correct by construction. The
        user is not told the assistant failed — they are given the answer, which is what
        they asked for. What went wrong belongs in the logs.
        """
        windows, blocker = plan(hours, profile)
        logger.info("agent.fallback", reason=reason, windows=len(windows))

        if not windows:
            detail = (
                f"{blocker[0]} sınırın tek başına {blocker[1]} saati eledi."
                if blocker
                else "Uygun bir saat bulunamadı."
            )
            return AgentAnswer(
                response=PlanResponse(
                    verdict="bad",
                    best_window=None,
                    reason=f"Sınırlarını geçen bir pencere yok. {detail}",
                    warnings=[],
                ),
                tool_calls=tuple(called),
                duration_ms=duration_ms,
                fell_back=True,
                fallback_reason=reason,
            )

        best = windows[0]
        return AgentAnswer(
            response=PlanResponse(
                verdict="good" if best.mean_score >= 85 else "mixed",
                best_window=ResponseWindow(
                    day=best.day,
                    start_hour=best.start_hour,
                    end_hour=best.end_hour,
                    score=round(best.mean_score, 1),
                ),
                reason=(
                    f"En iyi pencere {best.day} günü "
                    f"{best.start_hour:02d}:00–{best.end_hour:02d}:00 arası."
                ),
                warnings=[],
            ),
            tool_calls=tuple(called),
            duration_ms=duration_ms,
            fell_back=True,
            fallback_reason=reason,
        )
