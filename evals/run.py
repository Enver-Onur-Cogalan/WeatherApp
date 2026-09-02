#!/usr/bin/env python3
"""Evaluate the planning agent.

An agent without an evaluation suite is a demo: it works when you show it, and nobody
knows what happens otherwise. That is doubly true here, because the model was chosen for
being *not* comfortably capable — the project's claim is that careful engineering makes a
4B model reliable, and a claim needs evidence (docs/08).

What this measures, in descending order of how much it is trusted:

  1. Deterministic checks — did it call a tool, is the answer parseable, is it in the
     language it was asked in, did the model answer or did the engine.
  2. Groundedness — every figure, condition, day name and identifier checked against the
     data the tools actually returned. These are the same gates the agent runs in
     production, so the suite measures the shipped behaviour rather than a copy of it.
  3. Quality — not measured. A 4B model cannot grade its own output, and there is no
     hosted model to borrow (ADR-0004). Recorded as a limitation rather than faked.

Every figure is a rate over repeated runs. A model that passes once and fails once in
five has not passed, and reporting a single outcome would hide exactly that.

Usage:
    python3 evals/run.py                 # all scenarios, 3 repeats
    python3 evals/run.py --repeat 5
    python3 evals/run.py --only tr-      # scenarios whose id starts with this
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.agent.orchestrator import AgentAnswer, PlanningAgent  # noqa: E402
from app.agent.provider import ModelUnavailableError, OllamaProvider  # noqa: E402
from app.agent.validation import MACHINERY  # noqa: E402
from app.planning.models import Activity, ActivityProfile, ForecastHour  # noqa: E402

FIXTURES = ROOT / "benchmarks" / "fixtures"
SCENARIOS = Path(__file__).parent / "scenarios"
RESULTS = Path(__file__).parent / "results"

PROFILES: dict[str, ActivityProfile] = {
    "morning_runner": ActivityProfile(
        activity=Activity.RUNNING,
        temp_min=5,
        temp_max=26,
        wind_max_kmh=15,
        precip_max_pct=20,
        preferred_hours=(6, 10),
        uv_max=6,
    ),
}

TURKISH_LETTERS = set("çğıöşüÇĞİÖŞÜ")
# Function words, space-padded so they match whole words. Both lists started at seven
# entries and that was too thin to be safe: "Tomorrow, Tuesday, you have an activity
# window from six to sixteen." is unmistakable English containing none of them, and the
# suite reported perfectly good prose as a defect. A detector that cries wolf on correct
# output is worse than a coarse one, because it is the reason suites get switched off.
TURKISH_WORDS = (
    " için ", " ve ", " gün ", " günü ", " saat ", " saatleri ", " hava ", " arası ",
    " olabilir ", " en ", " iyi ", " bu ", " ile ", " daha ", " var ", " yok ", " bir ",
    " sonra ", " önce ", " kadar ", " çok ", " az ", " uygun ", " zaman ", " pencere ",
)
ENGLISH_WORDS = (
    " the ", " is ", " and ", " best ", " time ", " with ", " on ", " you ", " your ",
    " a ", " an ", " to ", " from ", " for ", " between ", " will ", " be ", " it ",
    " have ", " has ", " are ", " this ", " that ", " at ", " in ", " of ", " but ",
    " tomorrow ", " today ", " morning ", " afternoon ", " evening ", " window ",
)


def load_forecast(name: str) -> list[ForecastHour]:
    """A recorded Open-Meteo response as scored-engine input.

    Recorded rather than fetched: an evaluation whose results move with the weather is
    not an evaluation.
    """
    raw = json.loads((FIXTURES / f"{name}.json").read_text())["hourly"]
    hours: list[ForecastHour] = []
    for index in range(min(168, len(raw["time"]))):
        local = datetime.fromisoformat(raw["time"][index])
        hours.append(
            ForecastHour(
                hour_utc=(local - timedelta(seconds=10800)).replace(tzinfo=UTC),
                local_hour=local.hour,
                temperature_c=raw["temperature_2m"][index],
                precip_prob_pct=raw["precipitation_probability"][index],
                precip_mm=raw["precipitation"][index],
                wind_kmh=raw["wind_speed_10m"][index],
                uv_index=raw["uv_index"][index],
                cloud_cover_pct=raw["cloud_cover"][index],
                weather_code=raw.get("weather_code", [0] * 168)[index],
            )
        )
    return hours


def detect_language(text: str) -> str:
    """Which language an answer is in.

    Crude on purpose. The question is only ever "did it answer in the language it was
    asked in", and Turkish orthography answers that without a library.
    """
    if any(letter in text for letter in TURKISH_LETTERS):
        return "tr"
    lowered = f" {text.lower()} "
    turkish = sum(1 for word in TURKISH_WORDS if word in lowered)
    english = sum(1 for word in ENGLISH_WORDS if word in lowered)
    if turkish > english:
        return "tr"
    return "en" if english else "unknown"


# Checks whose failure means something wrong reached the user. A fallback is not one of
# them: the answer was still correct, just written by the engine rather than the model.
# Collapsing the two would report a gate doing its job as though it were a defect.
UNSAFE = frozenset(
    {
        "no_machinery",
        "language",
        "no_forbidden_terms",
        "window_is_well_formed",
        "answer_present",
    }
)


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""

    @property
    def unsafe(self) -> bool:
        return self.name in UNSAFE


@dataclass
class Run:
    checks: list[Check]
    duration_ms: int
    from_model: bool
    tools: list[str]
    answer: str

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    @property
    def safe(self) -> bool:
        """Nothing wrong reached the user, even if the model was not the one to answer."""
        return not any(check.unsafe and not check.passed for check in self.checks)


@dataclass
class ScenarioResult:
    id: str
    question: str
    runs: list[Run] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        return sum(1 for run in self.runs if run.passed) / len(self.runs)

    @property
    def model_rate(self) -> float:
        return sum(1 for run in self.runs if run.from_model) / len(self.runs)

    @property
    def safe_rate(self) -> float:
        return sum(1 for run in self.runs if run.safe) / len(self.runs)

    def failures(self) -> list[str]:
        seen: list[str] = []
        for run in self.runs:
            for check in run.checks:
                if not check.passed and check.name not in seen:
                    seen.append(f"{check.name}: {check.detail}")
        return seen


def evaluate(answer: AgentAnswer, scenario: dict[str, Any]) -> list[Check]:
    """The deterministic gates, run over one answer.

    Groundedness is not re-implemented here. The agent already rejects an ungrounded
    answer and falls back, so `from_model` carries that result — re-checking it would
    measure a copy of the rule rather than the rule.
    """
    expect = scenario.get("expect", {}) or {}
    response = answer.response
    text = f"{response.reason} {' '.join(response.warnings)}"
    checks: list[Check] = []

    checks.append(Check("answer_present", bool(response.reason.strip())))

    expected_language = scenario.get("language")
    if expected_language:
        found = detect_language(text)
        # Only a positive detection of the *wrong* language is a failure. An answer that
        # matches neither list is not evidence of anything, and treating "unknown" as a
        # defect made the suite report a correct English sentence as unsafe. The count
        # is still surfaced in the report, so a detector going blind stays visible
        # instead of quietly passing everything.
        checks.append(
            Check(
                "language",
                found in (expected_language, "unknown"),
                f"asked {expected_language}, answered {found}",
            )
        )

    # The defect a device session found: an internal identifier in prose meant for a
    # person. Checked here too, because a regression would otherwise only surface on
    # someone's screen.
    leaked = [token for token in MACHINERY if token in text.lower()]
    checks.append(Check("no_machinery", not leaked, ", ".join(leaked) if leaked else ""))

    if expect.get("from_model") is True:
        checks.append(
            Check(
                "answered_by_model",
                answer.fell_back is False,
                answer.fallback_reason,
            )
        )

    wanted = expect.get("tools")
    if wanted:
        called = set(answer.tool_calls)
        checks.append(
            Check(
                "called_expected_tool",
                bool(called & set(wanted)),
                f"called {sorted(called) or 'nothing'}",
            )
        )

    forbidden = [term for term in expect.get("forbid_terms", []) if term in text.lower()]
    if expect.get("forbid_terms") is not None:
        checks.append(Check("no_forbidden_terms", not forbidden, ", ".join(forbidden)))

    # A window in the answer must be one the engine produced. The agent attaches it, so
    # this is a wiring check rather than a model check — and wiring breaks quietly.
    if response.best_window is not None:
        checks.append(
            Check(
                "window_is_well_formed",
                bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", response.best_window.day))
                and 0 <= response.best_window.start_hour <= 23,
                response.best_window.day,
            )
        )

    return checks


async def run_scenario(
    agent: PlanningAgent,
    scenario: dict[str, Any],
    hours: list[ForecastHour],
    profile: ActivityProfile,
    repeat: int,
) -> ScenarioResult:
    result = ScenarioResult(id=scenario["id"], question=scenario["question"])

    for _ in range(repeat):
        started = time.perf_counter()
        try:
            answer = await agent.answer(scenario["question"], hours, profile)
        except ModelUnavailableError as exc:
            result.runs.append(
                Run(
                    checks=[Check("model_reachable", False, str(exc))],
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    from_model=False,
                    tools=[],
                    answer="",
                )
            )
            continue

        result.runs.append(
            Run(
                checks=evaluate(answer, scenario),
                duration_ms=answer.duration_ms,
                from_model=not answer.fell_back,
                tools=list(answer.tool_calls),
                answer=answer.response.reason,
            )
        )
    return result


def report(results: list[ScenarioResult], repeat: int, model: str) -> dict[str, Any]:
    total_runs = sum(len(r.runs) for r in results)
    passed_runs = sum(1 for r in results for run in r.runs if run.passed)
    model_runs = sum(1 for r in results for run in r.runs if run.from_model)
    durations = sorted(run.duration_ms for r in results for run in r.runs)

    print(f"\n{'=' * 72}")
    print(f"  {model}   {len(results)} scenarios × {repeat} repeats")
    print(f"{'=' * 72}\n")

    unsafe_runs = sum(1 for r in results for run in r.runs if not run.safe)
    undetermined = sum(
        1
        for r in results
        for run in r.runs
        for check in run.checks
        if check.name == "language" and check.detail.endswith("unknown")
    )

    for result in results:
        if result.safe_rate < 1.0:
            mark = "UNSAFE"
        elif result.pass_rate == 1.0:
            mark = "PASS"
        elif result.pass_rate == 0:
            mark = "ENGINE"
        else:
            mark = "FLAKY"
        print(f"  {mark:7} {result.pass_rate:>4.0%}  {result.id}")
        if result.pass_rate < 1.0:
            for failure in result.failures():
                print(f"            └─ {failure}")

    def rate(count: int) -> str:
        return f"{count}/{total_runs}  ({count / total_runs:.0%})"

    print(f"\n{'-' * 72}")
    print(f"  runs passing all checks   {rate(passed_runs)}")
    print(f"  answered by the model     {rate(model_runs)}")
    # The number that matters most. A fallback is a worse answer; an unsafe run is a
    # wrong one, and only the second is a defect.
    print(f"  reached the user wrong    {rate(unsafe_runs)}")
    if undetermined:
        # Not a failure, but not nothing: if this climbs, the detector has gone blind
        # and the language check is passing everything by default.
        print(f"  language undetermined     {rate(undetermined)}")
    if durations:
        median = durations[len(durations) // 2]
        print(f"  median latency            {median / 1000:.1f}s")
    print(f"{'-' * 72}\n")

    return {
        "model": model,
        "repeat": repeat,
        "generated_at": datetime.now(UTC).isoformat(),
        "summary": {
            "runs": total_runs,
            "passed": passed_runs,
            "pass_rate": round(passed_runs / total_runs, 3) if total_runs else 0,
            "model_rate": round(model_runs / total_runs, 3) if total_runs else 0,
            "unsafe": unsafe_runs,
            "language_undetermined": undetermined,
            "unsafe_rate": round(unsafe_runs / total_runs, 3) if total_runs else 0,
            "median_latency_ms": durations[len(durations) // 2] if durations else 0,
        },
        "scenarios": [
            {
                "id": r.id,
                "question": r.question,
                "pass_rate": round(r.pass_rate, 3),
                "model_rate": round(r.model_rate, 3),
                "failures": r.failures(),
                "answers": [run.answer for run in r.runs],
            }
            for r in results
        ],
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="gemma4:e4b")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--only", default="", help="run scenarios whose id starts with this")
    parser.add_argument("--base-url", default="http://localhost:11434")
    args = parser.parse_args()

    import yaml

    agent = PlanningAgent(
        provider=OllamaProvider(base_url=args.base_url, model=args.model, timeout_seconds=240)
    )

    results: list[ScenarioResult] = []
    for path in sorted(SCENARIOS.glob("*.yaml")):
        suite = yaml.safe_load(path.read_text())
        hours = load_forecast(suite["fixture"])
        profile = PROFILES[suite["profile"]]

        for scenario in suite["scenarios"]:
            if args.only and not scenario["id"].startswith(args.only):
                continue
            print(f"  running {scenario['id']}…", flush=True)
            results.append(await run_scenario(agent, scenario, hours, profile, args.repeat))

    if not results:
        print("no scenarios matched")
        return 1

    payload = report(results, args.repeat, args.model)
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"{args.model.replace(':', '_')}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"written to {out.relative_to(ROOT)}\n")

    # CI gates on the unsafe count, not the pass rate. A fallback is the system working
    # as designed and its rate will move with the model; something wrong reaching the
    # user is a defect at any rate. A suite that fails on every flake gets switched off
    # rather than fixed, and one that ignores a leak is worse than none.
    return 0 if payload["summary"]["unsafe"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
