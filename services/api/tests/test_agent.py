"""Tests for the planning agent.

The provider is a stand-in, so these run with no model on the machine — which is the
reason `Provider` is a protocol rather than an Ollama client. What they exercise is the
orchestration and the gates: the phase split, the tool loop, groundedness, the repair
attempt, and every route to the fallback.

Whether the real model actually calls the right tool is a different question, measured
in `benchmarks/` rather than asserted here.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.agent.language import detect
from app.agent.orchestrator import Exchange, PlanningAgent
from app.agent.provider import Completion, Message, ModelUnavailableError, ToolCall
from app.agent.tools import TOOLS, ToolRunner
from app.agent.validation import (
    MAX_WARNING,
    coherent,
    conditions_grounded,
    free_of_machinery,
    grounded,
    in_scope,
    parse,
    prune_warnings,
    repair_prompt,
    right_language,
    weekdays_grounded,
)
from app.planning.models import Activity, ActivityProfile, ForecastHour
from app.schemas.agent_answer import AgentAnswer as ModelAnswer
from app.schemas.plan_response import Window as ResponseWindow

MORNING_RUNNER = ActivityProfile(
    activity=Activity.RUNNING,
    temp_min=5,
    temp_max=26,
    wind_max_kmh=15,
    precip_max_pct=20,
    preferred_hours=(6, 10),
    uv_max=6,
)

BASE = datetime(2026, 8, 26, 21, 0, tzinfo=UTC)


def hours(count: int = 48, *, temp: float = 20.0, wind: float = 5.0) -> list[ForecastHour]:
    """A benign forecast: mornings clear the profile, nights do not."""
    out: list[ForecastHour] = []
    for i in range(count):
        utc = BASE + timedelta(hours=i)
        out.append(
            ForecastHour(
                hour_utc=utc,
                local_hour=(utc.hour + 3) % 24,
                temperature_c=temp,
                precip_prob_pct=0,
                precip_mm=0.0,
                wind_kmh=wind,
                uv_index=1.0,
                cloud_cover_pct=10,
                weather_code=0,
            )
        )
    return out


class ScriptedProvider:
    """Replays a fixed sequence of completions and records what it was asked."""

    def __init__(
        self,
        tool_turns: list[Completion] | None = None,
        structured_turns: list[Completion] | None = None,
        *,
        fail_with: Exception | None = None,
    ) -> None:
        self.tool_turns = list(tool_turns or [])
        self.structured_turns = list(structured_turns or [])
        self.fail_with = fail_with
        self.tool_prompts: list[list[Message]] = []
        self.structured_prompts: list[list[Message]] = []
        self.saw_tools_with_schema = False

    async def call_tools(
        self, messages: list[Message], tools: list[dict[str, Any]], *, think: bool = False
    ) -> Completion:
        if self.fail_with:
            raise self.fail_with
        self.tool_prompts.append(list(messages))
        return self.tool_turns.pop(0) if self.tool_turns else Completion(text="")

    async def structured(
        self, messages: list[Message], schema: dict[str, Any], *, think: bool = False
    ) -> Completion:
        if self.fail_with:
            raise self.fail_with
        self.structured_prompts.append(list(messages))
        return self.structured_turns.pop(0) if self.structured_turns else Completion(text="")

    async def available(self) -> bool:
        return self.fail_with is None


def answer_json(
    reason: str, *, warnings: list[str] | None = None, window_index: int | None = 0
) -> str:
    """What the model is asked for: judgement, prose, and which window it means.

    Never the window's figures — those come from the engine (ADR-0007). `window_index` is
    an index into the ranked list, which is how a card came to disagree with the sentence
    above it before the model got to choose (ADR-0017).
    """
    return ModelAnswer(
        verdict="good",
        reason=reason,
        warnings=warnings or [],
        window_index=window_index,
    ).model_dump_json()


class TestToolRunner:
    def test_windows_carry_their_own_numbers_as_facts(self) -> None:
        result = ToolRunner(hours(), MORNING_RUNNER).run("get_activity_windows", {})
        assert result.payload["windows"]
        assert result.facts, "a tool result with no facts cannot ground anything"

    def test_arguments_sent_as_a_json_string_still_work(self) -> None:
        """A drifting small model sometimes stringifies its own arguments."""
        runner = ToolRunner(hours(), MORNING_RUNNER)
        assert runner.run("get_forecast", '{"day": 1}') == runner.run(
            "get_forecast", {"day": 1}
        )

    def test_an_out_of_range_day_is_clamped_not_rejected(self) -> None:
        """Asking for day 42 is a reasonable question phrased badly."""
        runner = ToolRunner(hours(), MORNING_RUNNER)
        assert runner.run("get_forecast", {"day": 42}).payload["date"]

    def test_an_unknown_tool_reports_rather_than_raising(self) -> None:
        result = ToolRunner(hours(), MORNING_RUNNER).run("get_horoscope", {})
        assert "error" in result.payload

    def test_compare_states_the_comparison_instead_of_leaving_it(self) -> None:
        """ADR-0007: the model does not do arithmetic, including 'which is bigger'."""
        warm = hours(48)
        cold = [
            *warm[:24],
            *[
                ForecastHour(
                    hour_utc=h.hour_utc,
                    local_hour=h.local_hour,
                    temperature_c=5.0,
                    precip_prob_pct=h.precip_prob_pct,
                    precip_mm=h.precip_mm,
                    wind_kmh=h.wind_kmh,
                    uv_index=h.uv_index,
                    cloud_cover_pct=h.cloud_cover_pct,
                    weather_code=h.weather_code,
                )
                for h in warm[24:]
            ],
        ]
        payload = ToolRunner(cold, MORNING_RUNNER).run("compare_days", {"day_a": 0, "day_b": 1})
        assert payload.payload["warmer"] == payload.payload["a"]["date"]


class TestGroundedness:
    def test_a_figure_from_the_data_passes(self) -> None:
        response = parse(answer_json("Sabah 21 derece ve rüzgâr 16 km/h."))
        assert response is not None
        assert grounded(response, {"temp": {21.0}, "wind": {16.0}}).ok

    def test_an_invented_figure_fails_and_is_named(self) -> None:
        response = parse(answer_json("Sabah 47 derece olacak."))
        assert response is not None
        verdict = grounded(response, {"temp": {21.0}, "wind": {16.0}})
        assert not verdict.ok
        assert 47.0 in verdict.ungrounded

    def test_a_figure_stated_in_the_wrong_unit_fails(self) -> None:
        """The regression that unit-blind grounding let through.

        The real model claimed "15°C" for a day whose temperatures were 22–26. 15 was in
        the fact set — as an hour. A figure is only grounded in its own unit.
        """
        response = parse(answer_json("Yarın sabah 15 derece olacak."))
        assert response is not None
        facts = {"temp": {22.0, 23.0, 25.0, 26.0}, "hour": {0.0, 3.0, 15.0, 18.0}}
        verdict = grounded(response, facts)
        assert not verdict.ok
        assert 15.0 in verdict.ungrounded

    def test_the_same_figure_in_its_own_unit_passes(self) -> None:
        response = parse(answer_json("Rüzgâr 15 km/h."))
        assert response is not None
        assert grounded(response, {"wind": {15.0}, "temp": {22.0}}).ok

    def test_an_unmarked_figure_may_match_any_unit(self) -> None:
        """Unlabelled data should leave an answer unverified, not unverifiable."""
        response = parse(answer_json("Skor 96 civarında."))
        assert response is not None
        assert grounded(response, {"score": {96.0}}).ok

    def test_rounding_is_tolerated(self) -> None:
        """The tool returned 21.7 and the sentence says 22 — the same claim."""
        response = parse(answer_json("Sıcaklık 22 derece."))
        assert response is not None
        assert grounded(response, {"temp": {21.7}}).ok

    def test_small_numbers_are_language_not_measurement(self) -> None:
        """'ilk 3 gün' is not a numeric claim and must not fail grounding."""
        response = parse(answer_json("İlk 3 gün için 2 pencere var."))
        assert response is not None
        assert grounded(response, {}).ok

    def test_clock_times_are_not_treated_as_measurements(self) -> None:
        response = parse(answer_json("07:00 ile 11:00 arası uygun."))
        assert response is not None
        assert grounded(response, {}).ok

    def test_warnings_are_checked_too(self) -> None:
        """A figure smuggled into a warning is still a figure."""
        response = parse(answer_json("Sabah uygun.", warnings=["UV 91'e çıkıyor."]))
        assert response is not None
        assert not grounded(response, {"other": {3.0}}).ok

    def test_medical_advice_is_out_of_scope(self) -> None:
        response = parse(answer_json("Hava iyi ama doktor kontrolü öneririm."))
        assert response is not None
        assert not in_scope(response).ok


class TestLongFormDatesAreNotMeasurements:
    """A date written the way people write it is an identifier, not a figure.

    ISO_DATE already covered "2026-08-27". The evaluation suite then caught the same
    defect in the other calendar's clothes: "27 Ağustos Perşembe" offered 27 as a
    measurement, and a correct answer was rejected by the gate that exists to catch
    incorrect ones.
    """

    def test_turkish_long_date_is_not_a_figure(self) -> None:
        answer = ModelAnswer(
            verdict="good",
            reason="En iyi zaman 27 Ağustos Perşembe günü.",
            warnings=[],
            window_index=None,
        )
        assert grounded(answer, {}).ok

    def test_english_long_date_is_not_a_figure(self) -> None:
        answer = ModelAnswer(
            verdict="good",
            reason="The best time is August 27.",
            warnings=[],
            window_index=None,
        )
        assert grounded(answer, {}).ok

    def test_an_unaccented_month_still_counts(self) -> None:
        answer = ModelAnswer(
            verdict="good",
            reason="En iyi zaman 27 Agustos gunu.",
            warnings=[],
            window_index=None,
        )
        assert grounded(answer, {}).ok

    def test_a_real_measurement_is_still_caught(self) -> None:
        """Stripping dates must not stop the gate checking numbers."""
        answer = ModelAnswer(
            verdict="good",
            reason="27 Ağustos günü sıcaklık 34 derece olacak.",
            warnings=[],
            window_index=None,
        )
        assert not grounded(answer, {"temp": {21.0}}).ok


class TestConditionGrounding:
    """The hole that numeric grounding alone left open.

    The real model answered a rain-free forecast with "Thursday has a high chance of
    thunderstorms". It held no digits, so nothing checked it and it passed clean.
    """

    def test_a_condition_not_in_the_forecast_is_rejected(self) -> None:
        response = parse(answer_json("İyi.", warnings=["Perşembe fırtına bekleniyor."]))
        assert response is not None
        assert not conditions_grounded(response, {0, 1, 3}).ok

    def test_a_condition_that_is_in_the_forecast_passes(self) -> None:
        response = parse(answer_json("İyi.", warnings=["Perşembe fırtına bekleniyor."]))
        assert response is not None
        assert conditions_grounded(response, {0, 95}).ok

    def test_english_claims_are_checked_too(self) -> None:
        response = parse(answer_json("Thursday has a high chance of thunderstorms."))
        assert response is not None
        assert not conditions_grounded(response, {0, 1, 2, 3}).ok

    def test_a_judgement_is_left_to_the_model(self) -> None:
        """ "Pleasant" is not a fact about the data and is none of this check's business."""
        response = parse(answer_json("Hava koşu için gayet keyifli görünüyor."))
        assert response is not None
        assert conditions_grounded(response, {0}).ok


class TestMachineryLeak:
    """Reported from a device: "the tool name is showing".

    The provenance line was innocent — it correctly read "1 araç". The model had appended
    `get_activity_windows` to the end of a sentence written for a person, and every gate
    passed it: an identifier is neither a figure, nor a condition, nor a day.
    """

    def test_a_tool_name_in_the_answer_is_rejected(self) -> None:
        response = parse(answer_json("Sabah uygun. get_activity_windows"))
        assert response is not None
        assert not free_of_machinery(response).ok

    def test_a_leak_in_a_warning_is_rejected_too(self) -> None:
        response = parse(answer_json("Sabah uygun.", warnings=["tool result: rain"]))
        assert response is not None
        assert not free_of_machinery(response).ok

    def test_an_ordinary_answer_passes(self) -> None:
        response = parse(answer_json("Sabah 06:00–11:00 arası uygun görünüyor."))
        assert response is not None
        assert free_of_machinery(response).ok

    def test_the_retry_says_what_to_do_about_it(self) -> None:
        """Naming the fault is what makes a retry able to succeed."""
        response = parse(answer_json("Sabah uygun. get_forecast"))
        assert response is not None
        prompt = repair_prompt(free_of_machinery(response))
        assert "never name a tool" in prompt


class TestWeekdayGrounding:
    """The third kind of invented claim, after figures and conditions.

    The model wrote "Cumartesi (2026-09-02)" for a Wednesday. No digit was wrong, no
    condition was named, and both existing gates passed it — a day name is a claim about
    the calendar, and nothing was checking the calendar.
    """

    def test_a_day_the_forecast_does_not_cover_is_rejected(self) -> None:
        response = parse(answer_json("Cumartesi günü koşabilirsin."))
        assert response is not None
        # 2026-08-26 and 27 are a Wednesday and a Thursday.
        assert not weekdays_grounded(response, {"2026-08-26", "2026-08-27"}).ok

    def test_a_day_the_forecast_covers_passes(self) -> None:
        response = parse(answer_json("Çarşamba günü koşabilirsin."))
        assert response is not None
        assert weekdays_grounded(response, {"2026-08-26", "2026-08-27"}).ok

    def test_english_day_names_are_checked_too(self) -> None:
        response = parse(answer_json("Saturday looks best."))
        assert response is not None
        assert not weekdays_grounded(response, {"2026-08-26"}).ok

    def test_pazar_inside_pazartesi_does_not_match(self) -> None:
        """ "Pazar" is Sunday and also the Turkish for market, and it sits inside
        "Pazartesi" — a substring match would reject a correct Monday."""
        response = parse(answer_json("Pazartesi günü uygun."))
        assert response is not None
        # 2026-08-31 is a Monday; no Sunday in the set.
        assert weekdays_grounded(response, {"2026-08-31"}).ok


class TestToolsSupplyTheWeekday:
    def test_windows_carry_the_day_name(self) -> None:
        """Derived by the engine, so the model never computes a calendar mapping."""
        result = ToolRunner(hours(), MORNING_RUNNER).run("get_activity_windows", {})
        assert all("weekday" in window for window in result.payload["windows"])

    def test_the_day_name_is_correct(self) -> None:
        from app.agent.tools import weekday_of

        assert weekday_of("2026-09-02") == "Wednesday"
        assert weekday_of("2026-08-29") == "Saturday"


class TestCoherence:
    """The judgement is the model's; contradicting the numbers is not.

    The real model answered "there is not enough information about running this week"
    while the engine had seven ranked windows in front of it, and marked the verdict
    `bad` beside a window it scored 95.
    """

    def test_a_bad_verdict_beside_a_high_scoring_window_is_rejected(self) -> None:
        response = parse(
            ModelAnswer(
                verdict="bad",
                reason="Yeterli bilgi yok.",
                warnings=[],
                window_index=None,
            ).model_dump_json()
        )
        assert response is not None
        window = ResponseWindow(day="2026-08-27", start_hour=6, end_hour=11, score=95.2)
        assert not coherent(response, window).ok

    def test_a_mixed_verdict_beside_a_good_window_is_allowed(self) -> None:
        """A judgement may be cautious. It may not contradict the data."""
        response = parse(
            ModelAnswer(
                verdict="mixed",
                reason="Sabah uygun.",
                warnings=[],
                window_index=None,
            ).model_dump_json()
        )
        assert response is not None
        window = ResponseWindow(day="2026-08-27", start_hour=6, end_hour=11, score=95.2)
        assert coherent(response, window).ok

    def test_a_good_verdict_with_no_window_is_rejected(self) -> None:
        response = parse(
            ModelAnswer(
                verdict="good",
                reason="Harika.",
                warnings=[],
                window_index=None,
            ).model_dump_json()
        )
        assert response is not None
        assert not coherent(response, None).ok


class TestWindowComesFromTheEngine:
    """ADR-0007 past the arithmetic: the model does not choose the window either.

    Letting it emit one produced answers with `best_window: null` while the engine had
    ranked seven — a vaguer answer than the deterministic path it was meant to improve on.
    """

    @pytest.mark.asyncio
    async def test_the_window_is_attached_even_when_the_model_omits_it(self) -> None:
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[Completion(text=answer_json("Sabah uygun."))],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )

        from app.planning.scoring import plan

        windows, _ = plan(hours(), MORNING_RUNNER)
        assert answer.response.best_window is not None
        assert answer.response.best_window.start_hour == windows[0].start_hour

    @pytest.mark.asyncio
    async def test_no_window_stays_no_window(self) -> None:
        gale = hours(wind=70.0)
        provider = ScriptedProvider(
            structured_turns=[Completion(text=answer_json("Uygun değil."))],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", gale, MORNING_RUNNER
        )
        assert answer.response.best_window is None


class TestPhaseSeparation:
    @pytest.mark.asyncio
    async def test_tools_and_schema_are_never_requested_together(self) -> None:
        """ADR-0006's whole reason: together, tool calling measured 0%."""
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[Completion(text=answer_json("Sabah uygun."))],
        )
        await PlanningAgent(provider=provider).answer("ne zaman?", hours(), MORNING_RUNNER)

        assert provider.tool_prompts, "phase one ran"
        assert provider.structured_prompts, "phase two ran"
        assert not provider.saw_tools_with_schema

    @pytest.mark.asyncio
    async def test_tool_results_reach_the_second_phase_as_user_text(self) -> None:
        """Measured, not assumed: Gemma 4 does not read `role: "tool"`.

        Handed the same results under that role it answered "no specific information was
        provided". Folded into the user message it read them. The request succeeds either
        way, which is what makes the wrong shape so easy to ship.
        """
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[Completion(text=answer_json("Sabah uygun."))],
        )
        await PlanningAgent(provider=provider).answer("ne zaman?", hours(), MORNING_RUNNER)

        prompt = provider.structured_prompts[0]
        assert [m.role for m in prompt] == ["system", "user"]
        folded = prompt[-1].content
        assert "ne zaman?" in folded, "the question stays beside the data"
        assert "windows" in folded, "the tool payload itself is in the message"

    @pytest.mark.asyncio
    async def test_the_tool_loop_is_bounded(self) -> None:
        """A model that keeps calling is looping; a third round repeats the second."""
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),)),
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),)),
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),)),
            ],
            structured_turns=[Completion(text=answer_json("Sabah uygun."))],
        )
        answer = await PlanningAgent(provider=provider, max_tool_rounds=2).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )
        assert len(provider.tool_prompts) == 2
        assert len(answer.tool_calls) == 2


class TestValidationLoop:
    @pytest.mark.asyncio
    async def test_an_ungrounded_answer_is_retried_with_the_offending_figures(self) -> None:
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[
                Completion(text=answer_json("Sıcaklık 47 derece olacak.")),
                Completion(text=answer_json("Sabah uygun görünüyor.")),
            ],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )

        assert not answer.fell_back
        repair = provider.structured_prompts[1][-1].content
        assert "47" in repair, "the retry must name what failed, not just say try again"

    @pytest.mark.asyncio
    async def test_two_bad_answers_fall_back_rather_than_looping(self) -> None:
        provider = ScriptedProvider(
            # The tool call is not incidental. Without one the agent now answers that the
            # question is outside what it does, and never reaches the composing phase this
            # test is about.
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[
                Completion(text="not json at all"),
                Completion(text="still not json"),
            ],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )

        assert answer.fell_back
        assert answer.response.best_window is not None, "the engine still has an answer"


class TestOutOfScope:
    """Asked something this assistant does not do, it says so.

    Measured against the running service before this existed: "Merhaba", "Teşekkürler",
    "Sen kimsin?", "Gelecek ay nasıl olacak?" and "Rüzgar limitim 25 olsa ne değişirdi?"
    each produced *"the best window is Friday 06:00–11:00"* — a planning verdict recited
    at somebody who had said thank you.
    """

    @pytest.mark.asyncio
    async def test_small_talk_is_not_answered_with_a_plan(self) -> None:
        provider = ScriptedProvider(tool_turns=[Completion(text="Merhaba!")])
        answer = await PlanningAgent(provider=provider).answer(
            "Merhaba", hours(), MORNING_RUNNER
        )

        assert answer.response.best_window is None, "no window is an answer to a greeting"
        assert "hava durumu" in answer.response.reason.lower()

    @pytest.mark.asyncio
    async def test_it_says_how_far_ahead_it_can_see(self) -> None:
        provider = ScriptedProvider(tool_turns=[Completion(text="I cannot.")])
        answer = await PlanningAgent(provider=provider).answer(
            "Gelecek ay nasıl olacak?", hours(), MORNING_RUNNER
        )

        assert "yedi gün" in answer.response.reason

    @pytest.mark.asyncio
    async def test_a_follow_up_is_not_treated_as_out_of_scope(self) -> None:
        """No tool call plus a prior turn is a follow-up, not a question about nothing."""
        provider = ScriptedProvider(
            tool_turns=[Completion(text="")],
            structured_turns=[Completion(text=answer_json("Sabah serin olduğu için."))],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "neden?",
            hours(),
            MORNING_RUNNER,
            history=[Exchange(question="ne zaman?", answer="Sabah 06–10.")],
        )

        assert not answer.fell_back
        assert "serin" in answer.response.reason


class TestRejectionNamesTheGate:
    """The fallback reason has to say which gate spoke.

    It used to read "answer failed validation" for all six, and the evaluation suite
    recorded only that phrase — so diagnosing why a scenario kept falling back meant
    re-running the agent by hand under a patched method. The gate's name costs nothing
    to carry and is the first thing anyone wants.
    """

    @pytest.mark.asyncio
    async def test_a_leaked_tool_name_is_named_as_such(self) -> None:
        leaked = answer_json("Sabah uygun. get_activity_windows")
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[Completion(text=leaked), Completion(text=leaked)],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )
        assert answer.fell_back
        assert "free_of_machinery" in answer.fallback_reason

    @pytest.mark.asyncio
    async def test_an_ungrounded_figure_is_named_as_such(self) -> None:
        invented = answer_json("Sabah sıcaklık 88 derece olacak.")
        provider = ScriptedProvider(
            tool_turns=[
                Completion(text="", tool_calls=(ToolCall("get_activity_windows", {}),))
            ],
            structured_turns=[Completion(text=invented), Completion(text=invented)],
        )
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )
        assert answer.fell_back
        assert "grounded" in answer.fallback_reason

    def test_every_name_is_a_gate_that_exists(self) -> None:
        """The names are paired with the checks positionally, so drift is silent.

        Asserting a count and one index was the first version of this, and adding a gate
        broke it without finding anything: the position of a name is not the invariant.
        What matters is that each name is a real check — a renamed gate leaves a label
        pointing at nothing, and the rejection reason a person is shown is that label.
        """
        from app.agent import validation
        from app.agent.orchestrator import GATE_NAMES

        assert len(set(GATE_NAMES)) == len(GATE_NAMES), "a duplicated name mislabels one"
        for name in GATE_NAMES:
            assert callable(getattr(validation, name, None)), name


class TestFallbackLanguage:
    """Found by the evaluation suite on its first full run.

    The model is told to match the question's language. The fallback has no model to
    tell, and the first version hard-coded Turkish — so an English question fell back
    into a Turkish answer, in an app whose two languages are equals.
    """

    @pytest.mark.asyncio
    async def test_an_english_question_falls_back_in_english(self) -> None:
        provider = ScriptedProvider(fail_with=ModelUnavailableError("down"))
        answer = await PlanningAgent(provider=provider).answer(
            "When is the best time to run this week?", hours(), MORNING_RUNNER
        )
        assert "best window" in answer.response.reason.lower()

    @pytest.mark.asyncio
    async def test_a_turkish_question_falls_back_in_turkish(self) -> None:
        provider = ScriptedProvider(fail_with=ModelUnavailableError("down"))
        answer = await PlanningAgent(provider=provider).answer(
            "Bu hafta koşu için en iyi zaman ne zaman?", hours(), MORNING_RUNNER
        )
        assert "en iyi pencere" in answer.response.reason.lower()

    @pytest.mark.asyncio
    async def test_an_empty_result_is_explained_in_the_right_language(self) -> None:
        gale = hours(wind=70.0)
        provider = ScriptedProvider(fail_with=ModelUnavailableError("down"))
        answer = await PlanningAgent(provider=provider).answer(
            "Can I run this week?", gale, MORNING_RUNNER
        )
        assert "clears your limits" in answer.response.reason

    def test_unaccented_turkish_is_still_turkish(self) -> None:
        """People type without diacritics far more often than not."""
        assert detect("bu hafta kosu icin en iyi zaman ne zaman") == "tr"

    def test_an_unmistakably_english_question_is_english(self) -> None:
        assert detect("When is the best time to run this week?") == "en"


class TestFallback:
    @pytest.mark.asyncio
    async def test_an_unreachable_model_still_answers(self) -> None:
        """docs/01: lose capability, not availability."""
        provider = ScriptedProvider(fail_with=ModelUnavailableError("ollama is down"))
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", hours(), MORNING_RUNNER
        )

        assert answer.fell_back
        assert answer.fallback_reason == "assistant unreachable"
        assert answer.response.best_window is not None

    @pytest.mark.asyncio
    async def test_the_fallback_answer_comes_from_the_engine(self) -> None:
        """Correct by construction: it cites a window the engine actually produced."""
        forecast = hours()
        provider = ScriptedProvider(fail_with=ModelUnavailableError("down"))
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", forecast, MORNING_RUNNER
        )

        from app.planning.scoring import plan

        windows, _ = plan(forecast, MORNING_RUNNER)
        assert answer.response.best_window is not None
        assert answer.response.best_window.start_hour == windows[0].start_hour

    @pytest.mark.asyncio
    async def test_no_windows_names_the_blocking_constraint(self) -> None:
        gale = hours(wind=70.0)
        provider = ScriptedProvider(fail_with=ModelUnavailableError("down"))
        answer = await PlanningAgent(provider=provider).answer(
            "ne zaman?", gale, MORNING_RUNNER
        )

        assert answer.response.verdict == "bad"
        assert "wind" in answer.response.reason


class TestToolDefinitions:
    def test_the_surface_stays_small(self) -> None:
        """Small models degrade sharply as the tool list grows (docs/05)."""
        assert len(TOOLS) <= 3

    def test_descriptions_stay_short(self) -> None:
        """Descriptions longer than a couple of lines confuse a 4B model."""
        for tool in TOOLS:
            assert len(tool["function"]["description"]) <= 90


class TestPruningAdvice:
    """One unfounded warning used to cost the whole answer.

    Measured against the running model: asked "Yarın sabah koşabilir miyim?" it answered
    with an entirely grounded sentence — twenty-three degrees, three percent chance of
    rain — and then advised an umbrella. `conditions_grounded` rejected the answer for
    claiming rain, correctly, and fifteen seconds of correct prose went with it.
    """

    def _answer(self, reason: str, warnings: list[str]) -> ModelAnswer:
        return ModelAnswer(verdict="good", reason=reason, warnings=warnings, window_index=0)

    def test_an_unfounded_warning_is_dropped_and_the_answer_kept(self) -> None:
        response, dropped = prune_warnings(
            self._answer("Yarın sabah koşabilirsin.", ["Yağmur ihtimali var, şemsiye al."]),
            codes={0, 1},
            facts={},
        )
        assert response.warnings == []
        assert dropped == ["Yağmur ihtimali var, şemsiye al."]
        assert response.reason == "Yarın sabah koşabilirsin.", "the sentence survives"

    def test_a_founded_warning_is_kept(self) -> None:
        response, dropped = prune_warnings(
            self._answer("Öğleden sonra yağmurlu.", ["Yağmur bekleniyor, şemsiye al."]),
            codes={61},
            facts={},
        )
        assert dropped == []
        assert len(response.warnings) == 1

    def test_only_the_offending_warning_goes(self) -> None:
        """The others are independent sentences and are not made wrong by it."""
        response, dropped = prune_warnings(
            self._answer(
                "Sabah uygun.",
                ["UV yüksek, şapka tak.", "Kar yağacak, dikkat et."],
            ),
            codes={0},
            facts={},
        )
        assert response.warnings == ["UV yüksek, şapka tak."]
        assert dropped == ["Kar yağacak, dikkat et."]

    def test_a_bad_reason_is_still_the_gate_s_business(self) -> None:
        """Pruning does not launder the answer itself — only the advice beside it."""
        response, dropped = prune_warnings(
            self._answer("Yarın kar yağacak.", []), codes={0}, facts={}
        )
        assert dropped == []
        assert not conditions_grounded(response, {0}).ok


class TestRightLanguage:
    """The language is chosen by the person now, so it can be checked rather than asked for.

    Three Turkish scenarios in a full evaluation run came back in English while the model
    was merely being *told* to match the question. Nothing looked at the answer.
    """

    def _answer(self, reason: str) -> ModelAnswer:
        return ModelAnswer(verdict="good", reason=reason, warnings=[], window_index=0)

    def test_an_english_answer_to_a_turkish_question_is_rejected(self) -> None:
        verdict = right_language(
            self._answer("The user asked about the weekend, but the data is for Tuesday."),
            "tr",
        )
        assert not verdict.ok
        assert "answered en" in verdict.reason

    def test_a_turkish_answer_to_a_turkish_question_passes(self) -> None:
        assert right_language(self._answer("Cumartesi sabahı uygun."), "tr").ok

    def test_a_turkish_answer_without_diacritics_is_still_turkish(self) -> None:
        """People type without them more often than not, and the detector knows the words."""
        assert right_language(self._answer("Yarin sabah hava iyi olacak."), "tr").ok

    def test_a_sentence_in_neither_vocabulary_is_not_rejected(self) -> None:
        """The detector is crude by design. Only a positive detection of the *wrong*
        language is a failure — treating "cannot tell" as one would throw away correct
        short answers for being short."""
        assert right_language(self._answer("Sunny until two."), "en").ok
        assert right_language(self._answer("Sunny until two."), "tr").ok

    def test_the_repair_names_the_language_to_answer_in(self) -> None:
        """A retry told only that it was "rejected" repeats the drift."""
        verdict = right_language(self._answer("Saturday morning is best."), "tr")
        assert "Turkish" in repair_prompt(verdict)


class TestAPercentageIsNotAClaim:
    """Naming a condition's percentage reports the forecast; it does not predict weather.

    Measured against the running model, and the second false positive this gate has had.
    Asked "Yarın sabah koşabilir miyim?" it answered "Saat altıda sıcaklık yirmi üç derece
    ve yağmur yüzdesi yüzde üç" — which says it will not rain, in the most informative way
    available — and the gate rejected it for containing the word "yağmur". The whole
    answer fell back to the engine, twice in a row, in a full evaluation run.

    The first false positive was the denial ("yağmur yok"). Same shape, same lesson: the
    gate asks whether a condition was *asserted*, and a word is not an assertion.
    """

    def _answer(self, reason: str) -> ModelAnswer:
        return ModelAnswer(verdict="good", reason=reason, warnings=[], window_index=0)

    def test_a_turkish_percentage_is_not_a_claim(self) -> None:
        answer = self._answer("Sıcaklık yirmi üç derece ve yağmur yüzdesi yüzde üç.")
        assert conditions_grounded(answer, {0, 1}).ok

    def test_a_percent_sign_is_not_a_claim(self) -> None:
        assert conditions_grounded(self._answer("Yağmur ihtimali %3."), {0, 1}).ok

    def test_an_english_percentage_is_not_a_claim(self) -> None:
        assert conditions_grounded(self._answer("Rain chance is 5 percent."), {0, 1}).ok

    def test_an_unquantified_likelihood_is_still_a_claim(self) -> None:
        """The line is the number. "Likely" makes a claim about weather the forecast does
        not have; "three percent" makes a claim about the forecast itself."""
        answer = self._answer("Yağmur ihtimali yüksek, şemsiye al.")
        assert not conditions_grounded(answer, {0, 1}).ok

    def test_a_plain_claim_still_fails(self) -> None:
        assert not conditions_grounded(self._answer("Yarın yağmur yağacak."), {0, 1}).ok


class TestTheContractCrossesToPython:
    """One definition, two consumers, and for a while two different contracts.

    `packages/schema` exists so the API's shape and the model's grammar cannot drift. The
    generator undermined it quietly: constraints on an *array's items* were emitted for
    Zod and dropped for Pydantic, so `{"type": "array", "items": {"type": "string",
    "maxLength": 200}}` became `list[str]` on the server and `z.array(z.string().max(200))`
    on the client.

    The server then sent a 300-character warning that its own schema forbade, the client
    refused to parse it, and the failure surfaced as "the server is unreachable" on a
    request the server had logged as a success.
    """

    def _item_constraint(self, model: type, field: str, attribute: str) -> object:
        """The constraint attached to a list field's *items*, not to the list."""
        from typing import get_args

        annotation = model.model_fields[field].annotation
        item = get_args(annotation)[0]
        metadata = get_args(item)[1]
        return getattr(metadata, attribute)

    def test_a_warning_is_capped_on_the_server_too(self) -> None:
        from app.schemas.plan_response import PlanResponse

        assert self._item_constraint(PlanResponse, "warnings", "max_length") == 200

    def test_the_model_answer_carries_the_same_cap(self) -> None:
        assert self._item_constraint(ModelAnswer, "warnings", "max_length") == 200

    def test_the_constant_matches_the_contract(self) -> None:
        """`parse` filters the raw payload before it becomes a model, so it repeats the
        number. This is what stops the repeat from drifting."""
        assert self._item_constraint(ModelAnswer, "warnings", "max_length") == MAX_WARNING

    def test_an_hour_outside_the_day_is_refused(self) -> None:
        """The same generator gap silently dropped this one: `preferred_hours` said its
        items were 0–23 and the server accepted 99."""
        import pytest
        from pydantic import ValidationError

        from app.schemas.activity_profile import ActivityProfile

        with pytest.raises(ValidationError):
            ActivityProfile(
                activity="running",
                temp_min=5,
                temp_max=26,
                wind_max_kmh=15,
                precip_max_pct=20,
                preferred_hours=[6, 99],
                uv_max=6,
            )


class TestOverLongAdviceIsDropped:
    """Constrained decoding does not enforce a maximum length.

    Asked for advice (ADR-0017) the model wrote past the contract's 200 characters. The
    whole answer used to be lost to it — first as an unparseable reply, then as a client
    that refused the payload. One sentence of advice is the smaller thing to lose.
    """

    def test_a_long_warning_goes_and_the_answer_survives(self) -> None:
        payload = json.dumps(
            {
                "verdict": "good",
                "reason": "Sabah uygun.",
                "warnings": ["x" * 201],
                "window_index": 0,
            }
        )
        answer = parse(payload)

        assert answer is not None, "the answer is not thrown away with the advice"
        assert answer.warnings == []
        assert answer.reason == "Sabah uygun."

    def test_a_warning_at_the_limit_is_kept(self) -> None:
        payload = json.dumps(
            {
                "verdict": "good",
                "reason": "Sabah uygun.",
                "warnings": ["x" * 200],
                "window_index": 0,
            }
        )
        answer = parse(payload)

        assert answer is not None
        assert len(answer.warnings) == 1
