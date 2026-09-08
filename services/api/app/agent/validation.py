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
from datetime import date as date_type

from app.agent.language import (
    ENGLISH_WORDS,
    NAMES,
    TURKISH_LETTERS,
    TURKISH_WORDS,
    Language,
)
from app.agent.tools import TOOL_NAMES, Facts
from app.core.logging import get_logger
from app.schemas.agent_answer import AgentAnswer
from app.schemas.plan_response import Window

logger = get_logger(__name__)

# The contract's own cap on one warning, repeated here because the raw payload is filtered
# before it becomes a model. `test_agent.py` asserts the two agree — a literal that can
# drift from the schema is how the client and server came to disagree in the first place.
MAX_WARNING = 200

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

# The same trap in the form people actually write. "27 Ağustos Perşembe" put 27 forward
# as a measurement, and the answer was rejected for citing the date correctly — the
# identical defect ISO_DATE was added for, wearing the other calendar's clothes. Found
# by the evaluation suite, which is what a suite is for.
MONTHS = (
    "ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul"
    "|ekim|kasım|kasim|aralık|aralik"
    "|january|february|march|april|may|june|july|august|september|october|november"
    "|december"
)
LONG_DATE = re.compile(
    rf"\b(?:\d{{1,2}}\s+(?:{MONTHS})|(?:{MONTHS})\s+\d{{1,2}})\b", re.IGNORECASE
)


@dataclass(frozen=True, slots=True)
class Verdict:
    ok: bool
    reason: str = ""
    ungrounded: tuple[float, ...] = ()


def parse(raw: str) -> AgentAnswer | None:
    """The model's JSON into our own type, or nothing.

    Returning `None` rather than raising: an unparseable answer is a retry, and the
    caller already has a fallback that does not need an exception to find it.

    Over-long advice is dropped before validating rather than failing the whole answer.
    The contract caps a warning at 200 characters and constrained decoding does not
    enforce a maximum length, so the model can and does write past it — asked for advice
    (ADR-0017) it produced a 300-character sentence, which the client then refused to
    parse. Losing one sentence of advice is a far smaller thing than losing an answer that
    took half a minute to produce, and it is the same judgement `prune_warnings` makes
    about advice that is not grounded.
    """
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None

    if isinstance(payload, dict) and isinstance(payload.get("warnings"), list):
        kept = [
            warning
            for warning in payload["warnings"]
            if not (isinstance(warning, str) and len(warning) > MAX_WARNING)
        ]
        if len(kept) != len(payload["warnings"]):
            logger.info("agent.warning_too_long", dropped=len(payload["warnings"]) - len(kept))
        payload["warnings"] = kept

    try:
        return AgentAnswer.model_validate(payload)
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
    without_clock = CLOCK.sub(" ", LONG_DATE.sub(" ", ISO_DATE.sub(" ", text)))
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


# Saying a condition is absent is not claiming it is present, and the difference is the
# whole sentence. Turkish negates after the noun — "yağmur yok" — and English before it —
# "no rain" — so both sides of an occurrence are examined.
NEGATION_AFTER = (
    "yok",
    "olmayacak",
    "olmaz",
    "beklenmiyor",
    "beklenmez",
    "görünmüyor",
    "değil",
    "yağmayacak",
    "ihtimali düşük",
    "riski yok",
)
NEGATION_BEFORE = ("no", "not", "without", "little", "zero", "free of")

# How far to look. Long enough for "yağmur ihtimali düşük", short enough that a negation
# belonging to the next clause is not borrowed.
NEGATION_WINDOW = 24

# Naming a condition's *percentage* is reporting a figure, not claiming the weather.
# "Yağmur yüzdesi yüzde üç" says it will not rain, in the most informative way available,
# and the first version of this gate rejected the answer for containing the word.
#
# A percentage specifically, not any mention of likelihood: "yağmur ihtimali yüksek" makes
# a claim about weather the forecast does not have, and should still fail. The figure
# itself is then `grounded`'s business, which is the right division — this gate asks
# whether a condition was asserted, not whether a number is real.
PROBABILITY_MARKERS = ("yüzde", "%", "percent")


def _is_denied(text: str, word: str, at: int) -> bool:
    """Whether this occurrence asserts the condition at all.

    Two ways it does not. It can be **denied** — "yağmur yok", "no rain" — which Turkish
    does after the noun and English before it, so both sides are examined. Or it can be
    **quantified**, which is what a percentage does: a sentence that gives rain a number
    is reporting the forecast rather than predicting weather.
    """
    after = text[at + len(word) : at + len(word) + NEGATION_WINDOW]
    if any(marker in after for marker in NEGATION_AFTER):
        return True
    if any(marker in after for marker in PROBABILITY_MARKERS):
        return True

    before = text[max(0, at - NEGATION_WINDOW) : at]
    return any(f"{marker} " in f"{before} " for marker in NEGATION_BEFORE)


def conditions_grounded(response: AgentAnswer, codes: set[int]) -> Verdict:
    """Whether the weather the answer names is weather the forecast contains.

    Only claims that are checkable are checked. "It looks pleasant" is a judgement and
    stays the model's to make; "there are thunderstorms on Thursday" is a fact about the
    data, and if no hour carries a thunderstorm code then the model produced it.

    **A denial is not a claim.** The first version matched the word anywhere in the
    sentence, so asked "bu hafta yağmur var mı?" the model answered "yağmur yok" — which
    is true, and which this gate rejected for containing the word "yağmur". Found by
    running ordinary questions against the service: a correct answer to one of the most
    natural things anyone asks a weather app was being thrown away by the gate meant to
    catch invention.
    """
    text = f"{response.reason} {' '.join(response.warnings)}".lower()

    for word, valid in CONDITION_CLAIMS.items():
        if codes & valid:
            continue  # The forecast has it; nothing to check.

        at = text.find(word)
        while at != -1:
            if not _is_denied(text, word, at):
                return Verdict(
                    ok=False,
                    reason=(
                        f"claims '{word}' but no hour in the forecast carries that condition"
                    ),
                )
            at = text.find(word, at + 1)

    return Verdict(ok=True)


# Day names in both of the app's languages, indexed the way `date.weekday()` is.
WEEKDAY_WORDS: dict[str, int] = {
    "pazartesi": 0,
    "monday": 0,
    "salı": 1,
    "tuesday": 1,
    "çarşamba": 2,
    "wednesday": 2,
    "perşembe": 3,
    "thursday": 3,
    "cuma": 4,
    "friday": 4,
    "cumartesi": 5,
    "saturday": 5,
    "pazar": 6,
    "sunday": 6,
}


def weekdays_grounded(response: AgentAnswer, dates: set[str]) -> Verdict:
    """Whether a named day is a day the forecast actually covers.

    The third kind of invented claim, after figures and conditions. The model wrote
    "Cumartesi (2026-09-02)" for a Wednesday: no digit was wrong, no condition was named,
    and both existing gates passed it. A day name is a claim about the calendar, and the
    calendar is checkable.

    "pazar" is deliberately matched as a whole word — it is also the Turkish for market,
    and inside "pazartesi" it would match the wrong day.
    """
    covered = {date_type(*(int(part) for part in day.split("-"))).weekday() for day in dates}
    text = f"{response.reason} {' '.join(response.warnings)}".lower()

    for word, index in WEEKDAY_WORDS.items():
        if re.search(rf"(?<![\w]){re.escape(word)}(?![\w])", text) and index not in covered:
            return Verdict(
                ok=False,
                reason=f"names '{word}' but the forecast covers no such day",
            )
    return Verdict(ok=True)


# Names for the machinery behind the answer. None of them belong in a sentence written
# for a person, and they are as much a defect as an invented number — an identifier is
# just as wrong and just as deterministic to catch.
MACHINERY: frozenset[str] = TOOL_NAMES | frozenset(
    {"tool result", "tool_call", "json", "schema", "araç sonuc", "arac sonuc"}
)


def free_of_machinery(response: AgentAnswer) -> Verdict:
    """Whether the answer leaked something internal into user-facing prose.

    The model appended `get_activity_windows` to the end of a sentence it wrote for a
    person. The provenance line was innocent — it correctly said "1 araç" — and every
    other gate passed, because an identifier is neither a figure nor a condition nor a
    day. It is still something no reader should ever see.
    """
    text = f"{response.reason} {' '.join(response.warnings)}".lower()
    for token in MACHINERY:
        if token in text:
            return Verdict(ok=False, reason=f"leaked an internal name into the answer: {token}")
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


def prune_warnings(
    response: AgentAnswer, codes: set[int], facts: Facts
) -> tuple[AgentAnswer, list[str]]:
    """Drop advice that rests on weather the forecast does not contain.

    The gates below judge an answer as one thing, and for `reason` that is right: a
    sentence with an invented figure in it is not partly usable. Warnings are different.
    They are independent sentences, so one bad one does not make the others wrong, and
    rejecting the whole answer over it throws away a correct sentence and fifteen seconds.

    Measured: asked "Yarın sabah koşabilir miyim?" the model answered "Yarın sabah
    koşabilirsin. Saat altıda sıcaklık yirmi üç derece ve yağmur yüzdesi yüzde üç" —
    entirely grounded — and then advised taking an umbrella. Three percent is not rain,
    and the whole answer fell back to the engine because of the advice attached to it.
    This is the cost ADR-0017 named: advice is a judgement, and a 4B model's judgement
    about when a number is worth mentioning is not reliable. What *is* reliable is
    checking the claim the advice makes, which is what this does.

    Dropping rather than repairing, because nothing false reaches the person either way
    and one of the two costs a person another wait. What is dropped is logged.
    """
    kept: list[str] = []
    dropped: list[str] = []

    for warning in response.warnings:
        probe = response.model_copy(update={"reason": "", "warnings": [warning]})
        if conditions_grounded(probe, codes).ok and grounded(probe, facts).ok:
            kept.append(warning)
        else:
            dropped.append(warning)

    if not dropped:
        return response, []
    return response.model_copy(update={"warnings": kept}), dropped


def right_language(response: AgentAnswer, language: Language) -> Verdict:
    """Whether the answer came back in the language it was asked for.

    Until the client started sending one, the language was inferred from the question and
    the model was asked to match it — a request nothing checked. It drifted: three
    Turkish scenarios in a full evaluation run came back in English, and the only reason
    anyone knew was that the suite looks. Now the language is chosen by the person, so it
    is a fact rather than a guess, and a fact can be a gate.

    Rejects only a *positive* detection of the wrong language. The detector is crude by
    design and its confident answers are the trustworthy ones; treating "cannot tell" as
    failure would reject correct short answers for being short.
    """
    spoken = _spoken(response.reason)
    if spoken is None or spoken == language:
        return Verdict(ok=True)
    return Verdict(ok=False, reason=f"asked for {language}, answered {spoken}")


def _spoken(text: str) -> Language | None:
    """Which language a sentence is in, or None when it genuinely cannot tell.

    `detect` answers the same question about a *question* and has to commit — a request
    always gets an answer in some language, so it defaults to Turkish. Here a wrong guess
    would throw away a correct answer, so the third outcome has to exist: "Sunny until
    two" contains no word either list knows, and calling that Turkish would reject it.
    """
    if any(letter in text for letter in TURKISH_LETTERS):
        return "tr"

    words = {word for word in text.lower().replace("?", " ").split() if word}
    turkish = len(words & TURKISH_WORDS)
    english = len(words & ENGLISH_WORDS)

    if turkish > english:
        return "tr"
    if english > turkish:
        return "en"
    return None


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
    if "asked for" in verdict.reason:
        wanted = NAMES[verdict.reason.split("asked for ")[1].split(",")[0]]
        return f"Your previous answer was in the wrong language. Answer again in {wanted}."
    if "internal name" in verdict.reason:
        return (
            f"Your previous answer was rejected: {verdict.reason}. Write for a person — "
            "never name a tool, a field, or a format in the answer itself."
        )
    return f"Your previous answer was rejected: {verdict.reason}. Answer again."


def as_json(response: AgentAnswer) -> str:
    return json.dumps(response.model_dump(), ensure_ascii=False)
