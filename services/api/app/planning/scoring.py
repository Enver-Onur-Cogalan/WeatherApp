"""The scoring engine.

Pure functions over forecast data. No I/O, no model, no randomness — the same inputs
always produce the same windows, which is what makes the agent's numbers checkable and
lets the empty state say *why*.

The rule this module exists to enforce (ADR-0007): the language model may describe a
window, but it never computes one.
"""

from __future__ import annotations

from .models import ActivityProfile, ForecastHour, HourScore, Window

# Weights are engine constants, not profile fields. What a degree over the limit costs
# has to be the same for everyone or two people's scores are not comparable — and no
# user could reasonably tune them anyway. See docs/12.
PENALTY_PER_DEGREE = 9.0
PENALTY_PER_KMH = 3.5
PENALTY_PER_PRECIP_PCT = 1.8
PENALTY_PER_UV = 6.0

# Hours outside the preferred range decay; the small hours are effectively out.
PENALTY_PER_HOUR_OFF = 3.5
PENALTY_UNSOCIAL_HOUR = 42.0
UNSOCIAL_HOURS = frozenset(range(21, 24)) | frozenset(range(0, 6))

# WMO codes that remove an hour outright regardless of profile. Not a preference:
# nobody's cycling window survives a thunderstorm because they ticked a box.
HARD_EXCLUSION_CODES = frozenset(
    {
        56,
        57,  # freezing drizzle
        66,
        67,  # freezing rain
        95,
        96,
        99,  # thunderstorm, thunderstorm with hail
    }
)

WINDOW_THRESHOLD = 75.0
MIN_WINDOW_HOURS = 2


def _hour_preference_penalty(local_hour: int, preferred: tuple[int, int]) -> float:
    """Distance from the hours this person actually goes out.

    Without this term every calm, cool night scores perfectly and the engine recommends
    a 03:00 run. The field was in the profile from the start; the formula was missing it.
    """
    start, end = preferred
    if start <= local_hour <= end:
        return 0.0
    if local_hour in UNSOCIAL_HOURS:
        return PENALTY_UNSOCIAL_HOUR
    distance = min(abs(local_hour - start), abs(local_hour - end))
    return distance * PENALTY_PER_HOUR_OFF


def score_hour(hour: ForecastHour, profile: ActivityProfile) -> HourScore:
    """Score one hour against one profile, keeping every penalty that was applied."""
    penalties: dict[str, float] = {}

    if hour.temperature_c > profile.temp_max:
        penalties["temperature"] = (hour.temperature_c - profile.temp_max) * PENALTY_PER_DEGREE
    elif hour.temperature_c < profile.temp_min:
        penalties["temperature"] = (profile.temp_min - hour.temperature_c) * PENALTY_PER_DEGREE

    if hour.wind_kmh > profile.wind_max_kmh:
        penalties["wind"] = (hour.wind_kmh - profile.wind_max_kmh) * PENALTY_PER_KMH

    if hour.precip_prob_pct > profile.precip_max_pct:
        penalties["precipitation"] = (
            hour.precip_prob_pct - profile.precip_max_pct
        ) * PENALTY_PER_PRECIP_PCT

    if profile.uv_max is not None and hour.uv_index > profile.uv_max:
        penalties["uv"] = (hour.uv_index - profile.uv_max) * PENALTY_PER_UV

    preference = _hour_preference_penalty(hour.local_hour, profile.preferred_hours)
    if preference:
        penalties["time_of_day"] = preference

    excluded = hour.weather_code in HARD_EXCLUSION_CODES
    if excluded:
        penalties["severe_weather"] = 100.0

    score = 0.0 if excluded else max(0.0, min(100.0, 100.0 - sum(penalties.values())))
    return HourScore(hour=hour, score=score, excluded=excluded, penalties=penalties)


def score_hours(hours: list[ForecastHour], profile: ActivityProfile) -> list[HourScore]:
    return [score_hour(hour, profile) for hour in hours]


def find_windows(
    scored: list[HourScore],
    threshold: float = WINDOW_THRESHOLD,
    min_hours: int = MIN_WINDOW_HOURS,
) -> list[Window]:
    """Group contiguous hours above the threshold into windows.

    Windows never span a gap: one bad hour in the middle splits them, because an hour of
    hail during a bike ride is not an average, it is the end of the ride.
    """
    windows: list[Window] = []
    run: list[tuple[int, HourScore]] = []

    for index, hour_score in enumerate(scored):
        if hour_score.score >= threshold and not hour_score.excluded:
            run.append((index, hour_score))
            continue
        if len(run) >= min_hours:
            windows.append(Window(run[0][0], run[-1][0], tuple(h for _, h in run)))
        run = []

    if len(run) >= min_hours:
        windows.append(Window(run[0][0], run[-1][0], tuple(h for _, h in run)))

    return windows


def rank_windows(windows: list[Window]) -> list[Window]:
    """Best first: mean score, then length, then earliest.

    Length breaks ties because a three-hour window at 88 is more useful than a two-hour
    one at 88 — it survives the plan moving by half an hour.
    """
    return sorted(windows, key=lambda w: (-w.mean_score, -w.length_hours, w.start_index))


def dominant_blocker(
    scored: list[HourScore], threshold: float = WINDOW_THRESHOLD
) -> tuple[str, int] | None:
    """Which constraint eliminated the most hours a person would actually have used.

    This is what turns "no windows found" into something to act on. Two rules keep the
    answer useful rather than merely true:

    Only hours inside the preferred range are counted. Run it over the whole week and
    the honest answer is always `time_of_day` — most of any week is outside anyone's
    preferred hours — which tells a person it was night, which they knew.

    And `time_of_day` is never reported. It is the one penalty that is not weather, and
    "you asked for mornings" is not a finding.
    """
    counts: dict[str, int] = {}
    for hour_score in scored:
        if hour_score.score >= threshold:
            continue
        if "time_of_day" in hour_score.penalties:
            continue
        worst = max(
            (name for name in hour_score.penalties if name != "time_of_day"),
            key=lambda name: hour_score.penalties[name],
            default=None,
        )
        if worst is not None:
            counts[worst] = counts.get(worst, 0) + 1

    if not counts:
        return None
    name = max(counts, key=lambda key: counts[key])
    return name, counts[name]


def plan(
    hours: list[ForecastHour], profile: ActivityProfile
) -> tuple[list[Window], tuple[str, int] | None]:
    """Score, group, rank — and say what blocked the rest."""
    scored = score_hours(hours, profile)
    ranked = rank_windows(find_windows(scored))
    return ranked, dominant_blocker(scored)
