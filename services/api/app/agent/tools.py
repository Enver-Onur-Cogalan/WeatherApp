"""The tool surface, and what happens when the model calls one.

Three tools, descriptions capped at two lines. Small models degrade sharply as the list
grows and as descriptions get longer, and 4B is well inside the range where that matters
(docs/05). Anything reachable deterministically is not a tool: geocoding, unit
conversion and timezone handling all happen before the model is called at all.

The tools return *facts*, never prose. Each one hands back numbers the scoring engine
produced, which is what lets the groundedness check afterwards verify that every figure
in the answer came from somewhere real rather than from the model.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date as date_type
from typing import Any

from app.planning.daily import local_date, summarise_days
from app.planning.models import ActivityProfile, ForecastHour
from app.planning.scoring import dominant_blocker, plan

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def conditions_over(hours: list[ForecastHour], window: Any) -> dict[str, Any]:
    """What the weather does across a window.

    Computed here, from the same hours the engine scored, so the numbers a person ends up
    reading came from arithmetic rather than from a 4B model's recollection (ADR-0007).

    The window's hours are found by local hour on its own day rather than by slicing an
    index range: `plan()` may be given a horizon that starts partway through a day, and an
    offset of a few hours would silently describe the wrong weather.
    """
    inside = [
        hour
        for hour in hours
        if local_date(hour) == window.day
        and window.start_hour <= hour.local_hour <= window.end_hour
    ]
    if not inside:
        return {}

    return {
        "temp_min": round(min(hour.temperature_c for hour in inside)),
        "temp_max": round(max(hour.temperature_c for hour in inside)),
        "wind_max": round(max(hour.wind_kmh for hour in inside)),
        "precip_max": round(max(hour.precip_prob_pct for hour in inside)),
        "uv_max": round(max(hour.uv_index for hour in inside)),
    }


def weekday_of(iso_date: str) -> str:
    """The day name for a date.

    Handed to the model rather than left for it to derive. Asked to work it out, Gemma 4
    answered "Cumartesi (2026-09-02)" for a Wednesday — ADR-0007's rule reaching past
    arithmetic into the calendar. Translating "Saturday" is a lexical task it does well;
    deriving Saturday from a date is one it does not.

    English, because the tool does not know what language the question was in — and
    picking a word is something the model can be trusted with.
    """
    year, month, day = (int(part) for part in iso_date.split("-"))
    return WEEKDAYS[date_type(year, month, day).weekday()]


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_activity_windows",
            "description": "Best time windows for the user's activity in the coming days.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days_ahead": {
                        "type": "integer",
                        "description": "How many days to search, 1 to 7.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_forecast",
            "description": "Hourly weather for one day. Day 0 is today, 1 is tomorrow.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "integer", "description": "Day offset from today, 0 to 6."}
                },
                "required": ["day"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_days",
            "description": "Compare two days. Offsets from today, 0 to 6.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_a": {"type": "integer"},
                    "day_b": {"type": "integer"},
                },
                "required": ["day_a", "day_b"],
            },
        },
    },
]

TOOL_NAMES = frozenset(tool["function"]["name"] for tool in TOOLS)


# Which unit each key in a tool payload carries. Grounding was a flat set of numbers at
# first, and it let the model state "15°C" against a day whose temperatures were 22–26:
# 15 was in the set as an *hour*. A number is only grounded in the unit it was measured
# in, so the facts are bucketed and the check compares like with like.
UNIT_OF: dict[str, str] = {
    "temp": "temp",
    "temp_min": "temp",
    "temp_max": "temp",
    "wind": "wind",
    "rain_pct": "pct",
    "score": "score",
    "hour": "hour",
    "start_hour": "hour",
    "end_hour": "hour",
    "hours": "count",
    "windows": "count",
}

Facts = dict[str, set[float]]


@dataclass(frozen=True, slots=True)
class ToolResult:
    """What a tool produced, and every number it contained, by unit.

    `facts` is not a debugging aid. It is what the groundedness check runs against — a
    figure in the model's answer that is not in here did not come from the data
    (docs/04).
    """

    name: str
    payload: dict[str, Any]
    facts: Facts

    def as_text(self) -> str:
        return json.dumps(self.payload, ensure_ascii=False, separators=(",", ":"))


def _collect(value: Any, into: Facts, unit: str = "other") -> None:
    """Every number in a structure, filed under the unit its key implies.

    A key with no known unit files under `other`, which the check treats as matching any
    unit — unlabelled data should not make an answer unverifiable, only unverified.
    """
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        into.setdefault(unit, set()).add(round(float(value), 1))
    elif isinstance(value, dict):
        for key, item in value.items():
            _collect(item, into, UNIT_OF.get(key, unit if key == "" else "other"))
    elif isinstance(value, list):
        for item in value:
            _collect(item, into, unit)


def merge(into: Facts, extra: Facts) -> None:
    for unit, values in extra.items():
        into.setdefault(unit, set()).update(values)


def _coerce(arguments: Any) -> dict[str, Any]:
    """Tool arguments, whatever shape the model sent them in.

    Ollama hands back an object, but a drifting small model sometimes sends the JSON as
    a string instead. Recovering from that costs three lines and saves a turn.
    """
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _int_arg(arguments: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    """One integer argument, clamped.

    A model that asks for day 42 is asking for something reasonable in a broken way.
    Clamping answers the question it meant; erroring would spend a turn teaching it
    about the range.
    """
    raw = arguments.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


class ToolRunner:
    """Executes tool calls against the forecast already in hand.

    The model never fetches anything. The hours were retrieved and scored before it was
    invoked, so a tool call is a question about data the request already holds — which
    is why there is no network here and no way for the agent to reach one.
    """

    def __init__(self, hours: list[ForecastHour], profile: ActivityProfile) -> None:
        self._hours = hours
        self._profile = profile
        self._days = summarise_days(hours)

    def run(self, name: str, arguments: Any) -> ToolResult:
        args = _coerce(arguments)
        if name == "get_activity_windows":
            payload = self._windows(_int_arg(args, "days_ahead", 7, 1, 7))
        elif name == "get_forecast":
            payload = self._forecast(_int_arg(args, "day", 0, 0, len(self._days) - 1))
        elif name == "compare_days":
            payload = self._compare(
                _int_arg(args, "day_a", 0, 0, len(self._days) - 1),
                _int_arg(args, "day_b", 1, 0, len(self._days) - 1),
            )
        else:
            payload = {"error": f"unknown tool: {name}"}
        facts: Facts = {}
        _collect(payload, facts)
        return ToolResult(name=name, payload=payload, facts=facts)

    def _windows(self, days_ahead: int) -> dict[str, Any]:
        horizon = self._hours[: days_ahead * 24]
        ranked, blocker = plan(horizon, self._profile)
        return {
            "windows": [
                {
                    "day": window.day,
                    "weekday": weekday_of(window.day),
                    "start_hour": window.start_hour,
                    "end_hour": window.end_hour,
                    "score": round(window.mean_score),
                    # The conditions, without which this tool describes a calendar rather
                    # than the weather. It returned only times and a score, so the model
                    # had no temperature, wind or rain for any window it recommended — and
                    # the answers read like a scheduling assistant because that is all it
                    # had been told. The grounding gate then kept it that way: a figure it
                    # was never given is a figure it cannot state.
                    **conditions_over(horizon, window),
                }
                for window in ranked[:5]
            ],
            "blocked_by": (
                {"constraint": blocker[0], "hours": blocker[1]} if blocker else None
            ),
        }

    def _day_hours(self, day: int) -> list[ForecastHour]:
        return self._hours[day * 24 : (day + 1) * 24]

    def _forecast(self, day: int) -> dict[str, Any]:
        summary = self._days[day]
        # Every third hour. The full 24 is more tokens than a 4B model reads carefully,
        # and the shape of a day survives the thinning.
        sampled = self._day_hours(day)[::3]
        return {
            "date": summary.date,
            "weekday": weekday_of(summary.date),
            "temp_min": round(summary.temp_min_c),
            "temp_max": round(summary.temp_max_c),
            "weather_code": summary.weather_code,
            "hours": [
                {
                    "hour": hour.local_hour,
                    "temp": round(hour.temperature_c),
                    "wind": round(hour.wind_kmh),
                    "rain_pct": hour.precip_prob_pct,
                }
                for hour in sampled
            ],
        }

    def _compare(self, day_a: int, day_b: int) -> dict[str, Any]:
        a, b = self._days[day_a], self._days[day_b]
        scored_a, _ = plan(self._day_hours(day_a), self._profile)
        scored_b, _ = plan(self._day_hours(day_b), self._profile)
        return {
            "a": {
                "date": a.date,
                "weekday": weekday_of(a.date),
                "temp_max": round(a.temp_max_c),
                "rain_pct": a.precip_prob_max_pct,
                "windows": len(scored_a),
            },
            "b": {
                "date": b.date,
                "weekday": weekday_of(b.date),
                "temp_max": round(b.temp_max_c),
                "rain_pct": b.precip_prob_max_pct,
                "windows": len(scored_b),
            },
            # Stated rather than left for the model to work out. It is a comparison of
            # two numbers, and ADR-0007 says the model does not do arithmetic.
            "warmer": a.date if a.temp_max_c > b.temp_max_c else b.date,
        }


def blocker_facts(hours: list[ForecastHour], profile: ActivityProfile) -> Facts:
    """Numbers the answer may legitimately cite even without a matching tool call."""
    from app.planning.scoring import score_hours

    blocker = dominant_blocker(score_hours(hours, profile))
    return {"count": {float(blocker[1])}} if blocker else {}
