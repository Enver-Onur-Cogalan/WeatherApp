"""The gates every model answer passes before a person sees it.

Schema validity is guaranteed by constrained decoding and checked again here, because a
grammar only guarantees *structure*. What it cannot guarantee is that the values are
retrieved rather than invented — which is the failure that matters, since an invented
number looks exactly like a real one (docs/04).

Groundedness is therefore deterministic and does the real work: every figure in the
prose is matched against the numbers the tools actually returned. It is the check that
makes a 4B model defensible. Fluency we can live without; invented numbers we cannot.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.agent.tools import Facts
from app.schemas.agent_answer import AgentAnswer
from app.schemas.plan_response import Window

# Matches integers and decimals, including a leading minus, but not the digits inside a
# word like "H2O" — a bare number is what a claim about the weather looks like.
NUMBER = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w])")

# Small integers are ordinary language, not measurements: "2 saat", "ilk 3 gün". Checking
# them produces false failures on sentences that never made a numeric claim.
GROUNDING_FLOOR = 12.0

# Hours of the day are already constrained by the schema's own bounds, and appear in
# prose constantly ("07:00"). The time is matched separately from the measurements.
CLOCK = re.compile(r"\b([01]?\d|2[0-3]):[0-5]\d\b")

# Dates are identifiers, not measurements. Without this the model was rejected for
# citing the day correctly: "2026-08-27" yields 2026 as a figure, which appears in no
# forecast, so a right answer failed the check that exists to catch wrong ones.
ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


@dataclass(frozen=True, slots=True)
class Verdict:
    ok: bool
    reason: str = ""
    ungrounded: tuple[float, ...] = ()


def parse(raw: str) -> AgentAnswer | None:
    """The model's JSON into our own type, or nothing.

    Returning `None` rather than raising: an unparseable answer is a retry, and the
    caller already has a fallback that does not need an exception to find it.
    """
    try:
        return AgentAnswer.model_validate_json(raw)
    except (ValueError, TypeError):
        return None


# What a number is followed by tells you what it measures. Grounding was unit-blind at
# first and let the model claim "15°C" for a day whose temperatures were 22–26 — 15 was
# in the fact set as an hour. A figure is only grounded in its own unit.
UNIT_MARKERS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\s*(?:°|derece|degree)", re.I), "temp"),
    (re.compile(r"\s*(?:km\s*/\s*[hs]|km/h)", re.I), "wind"),
)
PERCENT_BEFORE = re.compile(r"%\s*$")


def _claims(text: str) -> list[tuple[float, str]]:
    """Numbers in prose that amount to a claim, each with the unit it was stated in.

    Clock times are stripped first: `07:00` is two numbers to a regex and one span of
    time to a reader, and the schema already bounds the hours it carries.
    """
    without_clock = CLOCK.sub(" ", ISO_DATE.sub(" ", text))
    found: list[tuple[float, str]] = []

    for match in NUMBER.finditer(without_clock):
        try:
            value = float(match.group().replace(",", "."))
        except ValueError:
            continue
        if abs(value) < GROUNDING_FLOOR:
            continue

        after = without_clock[match.end() : match.end() + 12]
        before = without_clock[max(0, match.start() - 3) : match.start()]

        unit = "other"
        if PERCENT_BEFORE.search(before) or after.lstrip().startswith("%"):
            unit = "pct"
        else:
            for pattern, name in UNIT_MARKERS:
                if pattern.match(after):
                    unit = name
                    break
        found.append((round(value, 1), unit))
    return found


def grounded(response: AgentAnswer, facts: Facts, tolerance: float = 1.0) -> Verdict:
    """Whether every figure in the prose came from the data, in the unit it was stated in.

    A tolerance of one unit absorbs honest rounding — the tool returned 21.7 and the
    sentence says 22 — without admitting a number that was never retrieved. A figure
    stated with a unit is checked against that unit's bucket plus the unlabelled one; an
    unmarked figure may match anywhere, since unlabelled data should leave an answer
    unverified rather than unverifiable.
    """
    text = " ".join([response.reason, *response.warnings])
    everything = {value for values in facts.values() for value in values}

    unmatched: list[float] = []
    for value, unit in _claims(text):
        allowed = (
            facts.get(unit, set()) | facts.get("other", set())
            if unit != "other"
            else everything
        )
        if not any(abs(value - fact) <= tolerance for fact in allowed):
            unmatched.append(value)
    unmatched_t = tuple(sorted(set(unmatched)))
    if unmatched_t:
        return Verdict(
            ok=False,
            reason=f"figures not present in the retrieved data: {unmatched_t}",
            ungrounded=unmatched_t,
        )
    return Verdict(ok=True)


# Weather a sentence can claim, and the WMO codes that would make the claim true.
# Groundedness on numbers alone let "Thursday has a high chance of thunderstorms" pass
# cleanly against a forecast containing no thunderstorm: the sentence held no digits, so
# nothing checked it. A claim does not have to be numeric to be invented.
CONDITION_CLAIMS: dict[str, frozenset[int]] = {
    "fırtına": frozenset({95, 96, 99}),
    "thunderstorm": frozenset({95, 96, 99}),
    "dolu": frozenset({96, 99}),
    "hail": frozenset({96, 99}),
    "kar": frozenset({71, 73, 75, 77, 85, 86}),
    "snow": frozenset({71, 73, 75, 77, 85, 86}),
    "sis": frozenset({45, 48}),
    "fog": frozenset({45, 48}),
    "sağanak": frozenset({65, 66, 67, 80, 81, 82}),
    "downpour": frozenset({65, 66, 67, 80, 81, 82}),
    "yağmur": frozenset(range(51, 68)) | frozenset({80, 81, 82}),
    "rain": frozenset(range(51, 68)) | frozenset({80, 81, 82}),
}


def conditions_grounded(response: AgentAnswer, codes: set[int]) -> Verdict:
    """Whether the weather the answer names is weather the forecast contains.

    Only claims that are checkable are checked. "It looks pleasant" is a judgement and
    stays the model's to make; "there are thunderstorms on Thursday" is a fact about the
    data, and if no hour carries a thunderstorm code then the model produced it.
    """
    text = f"{response.reason} {' '.join(response.warnings)}".lower()
    for word, valid in CONDITION_CLAIMS.items():
        if word in text and not (codes & valid):
            return Verdict(
                ok=False,
                reason=f"claims '{word}' but no hour in the forecast carries that condition",
            )
    return Verdict(ok=True)


def in_scope(response: AgentAnswer) -> Verdict:
    """Whether the answer is still about the weather.

    A model that starts giving medical or travel advice has left the product, and a
    confident answer outside its competence is worse than no answer.
    """
    text = f"{response.reason} {' '.join(response.warnings)}".lower()
    for term in ("doktor", "ilaç", "hastane", "doctor", "medication", "diagnos"):
        if term in text:
            return Verdict(ok=False, reason=f"out of scope: {term}")
    return Verdict(ok=True)


GOOD_ENOUGH = 85.0
"""Above this the engine considers a window comfortably good."""


def coherent(response: AgentAnswer, window: Window | None) -> Verdict:
    """Whether the verdict agrees with what the engine actually found.

    The judgement is the model's to make — the numbers are not. A "bad" verdict sitting
    beside a window the engine scored 95 is the model contradicting the data it was
    handed, and the real model did exactly that: it answered "there is not enough
    information" while seven ranked windows were in front of it.
    """
    if window is None:
        if response.verdict == "good":
            return Verdict(ok=False, reason="verdict is good but no window clears the profile")
        return Verdict(ok=True)

    if response.verdict == "bad" and window.score >= GOOD_ENOUGH:
        return Verdict(
            ok=False,
            reason=f"verdict is bad but the best window scores {window.score:.0f}",
        )
    return Verdict(ok=True)


def repair_prompt(verdict: Verdict) -> str:
    """What to tell the model when its answer failed.

    Naming the offending figures rather than saying "try again" is the difference
    between a retry that can succeed and one that reruns the same mistake.
    """
    if verdict.ungrounded:
        listed = ", ".join(str(value) for value in verdict.ungrounded)
        return (
            f"Your previous answer used figures that are not in the data: {listed}. "
            "Use only numbers that appear in the tool results, and do not estimate."
        )
    return f"Your previous answer was rejected: {verdict.reason}. Answer again."


def as_json(response: AgentAnswer) -> str:
    return json.dumps(response.model_dump(), ensure_ascii=False)
