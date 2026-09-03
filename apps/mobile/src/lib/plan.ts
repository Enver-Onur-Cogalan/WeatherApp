/**
 * Reading a plan, and the vocabulary around it.
 *
 * The types are not declared here. `packages/schema` turns one JSON Schema into the
 * Pydantic models the server validates with and the Zod schemas the client parses with,
 * precisely so the two cannot drift — and an earlier version of this file declared its
 * own hand-written copy of every one of them, which is that drift with extra steps. They
 * are re-exported below so the rest of the app imports its types from here as before.
 *
 * What does belong here is everything the schema has no opinion about: which activities
 * the app offers, what their limits are, and how any of it is worded for a person.
 */

import type { ActivityProfile, PlanResult } from "@weatherapp/schema";

export type { ActivityProfile, PlanResult };

export type ScoredHour = PlanResult["hours"][number];
export type Window = NonNullable<PlanResult["windows"]>[number];
export type DaySummary = PlanResult["days"][number];

/**
 * The part of a window that can be written down.
 *
 * There are two window shapes in the schema, and the hand-written types hid it: the
 * ranked windows in a plan carry `length_hours`, the assistant's `best_window` does not.
 * Declaring one type for both meant the Sor screen was typed to read a field the API
 * never sends. Nothing broke, because the formatters only ever wanted these three — so
 * these three are what they now ask for, and both shapes satisfy it.
 */
export type WritableWindow = {
  day: string;
  start_hour: number;
  end_hour: number;
};

export const ACTIVITIES = ["running", "cycling", "picnic"] as const;
export type ActivityKey = (typeof ACTIVITIES)[number];

/** What the chips say. The engine's activity slug is not user-facing copy. */
export const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  running: "Koşu",
  cycling: "Bisiklet",
  picnic: "Piknik",
};

/** Why an hour lost points, in the user's words rather than the engine's field name. */
export const CONSTRAINT_LABELS: Record<string, string> = {
  temperature: "Sıcaklık",
  wind: "Rüzgâr",
  precipitation: "Yağış",
  uv: "UV",
  severe_weather: "Sert hava",
  time_of_day: "Saat",
};

/**
 * What each activity asks of the weather.
 *
 * Defaults, not preferences: docs/11 puts editable profiles under Sen and that screen is
 * unbuilt, so these are what the app sends until there is somewhere to store what a
 * person actually wants. The running profile matches the one the evaluation suite scores
 * against, so what the app asks for and what has been measured are the same question.
 */
export const PROFILES: Record<ActivityKey, ActivityProfile> = {
  running: {
    activity: "running",
    temp_min: 5,
    temp_max: 26,
    wind_max_kmh: 15,
    precip_max_pct: 20,
    preferred_hours: [6, 10],
    uv_max: 6,
  },
  cycling: {
    activity: "cycling",
    temp_min: 8,
    temp_max: 30,
    // A cyclist meets their own headwind, so the limit is tighter than a runner's
    // despite the wider temperature range.
    wind_max_kmh: 12,
    precip_max_pct: 15,
    preferred_hours: [7, 19],
    uv_max: 7,
  },
  picnic: {
    activity: "picnic",
    temp_min: 16,
    temp_max: 32,
    wind_max_kmh: 20,
    // Sitting still on the ground: rain ends it outright rather than making it harder.
    precip_max_pct: 5,
    preferred_hours: [11, 18],
    uv_max: 8,
  },
};

export type Span = "day" | "week";

export const SPAN_LABELS: Record<Span, string> = {
  day: "24 saat",
  week: "7 gün",
};

/**
 * Flat number arrays for the hours on screen.
 *
 * The canvas and the scrubber read these from a worklet on the UI runtime, and a
 * closure over an array of objects is copied across the runtime boundary every time it
 * changes. Numbers are cheap to carry; objects are not.
 */
export type TraceSlice = {
  count: number;
  /** The hours this slice covers, for anything needing a whole hour rather than one of
   *  the flat arrays — the atmosphere reads the scrubbed one. */
  hours: ScoredHour[];
  scores: number[];
  localHours: number[];
  temperature: number[];
  wind: number[];
  precipitation: number[];
  uv: number[];
  weatherCodes: number[];
  excluded: number[];
  /** Index pairs of the runs that clear the threshold, flattened: [startA, endA, startB, …]. */
  burns: number[];
};

const WINDOW_THRESHOLD = 75;
const MIN_WINDOW_HOURS = 2;

/** Contiguous runs above the threshold, recomputed for whatever slice is on screen. */
function findBurns(scores: number[], excluded: number[]): number[] {
  const runs: number[] = [];
  let start: number | null = null;

  for (let i = 0; i <= scores.length; i += 1) {
    const good = i < scores.length && scores[i] >= WINDOW_THRESHOLD && excluded[i] === 0;
    if (good) {
      if (start === null) start = i;
      continue;
    }
    if (start !== null && i - start >= MIN_WINDOW_HOURS) runs.push(start, i - 1);
    start = null;
  }
  return runs;
}

export function sliceFor(plan: PlanResult, span: Span, dayOffset = 0): TraceSlice {
  const from = span === "day" ? dayOffset * 24 : 0;
  const to = span === "day" ? from + 24 : plan.hours.length;
  const hours = plan.hours.slice(from, to);

  const scores = hours.map((h) => h.score);
  const excluded = hours.map((h) => (h.excluded ? 1 : 0));

  return {
    count: hours.length,
    hours,
    scores,
    excluded,
    localHours: hours.map((h) => h.local_hour),
    temperature: hours.map((h) => h.temperature_c),
    wind: hours.map((h) => h.wind_kmh),
    precipitation: hours.map((h) => h.precip_prob_pct),
    uv: hours.map((h) => h.uv_index),
    weatherCodes: hours.map((h) => h.weather_code),
    burns: findBurns(scores, excluded),
  };
}

/**
 * Where the scrubber opens: the start of that day's best window.
 *
 * Falling back to the day's highest-scoring hour rather than the middle means a day with
 * no window still opens somewhere meaningful instead of at an arbitrary noon.
 */
export function bestHourIndex(plan: PlanResult, slice: TraceSlice, dayOffset = 0): number {
  const date = plan.hours[dayOffset * 24]?.hour_utc.slice(0, 10);
  const best = plan.windows.find((w) => w.day === date);
  if (best) {
    const index = slice.localHours.indexOf(best.start_hour);
    if (index >= 0) return index;
  }
  let top = 0;
  for (let i = 1; i < slice.count; i += 1) {
    if (slice.scores[i] > slice.scores[top]) top = i;
  }
  return top;
}

const WEEKDAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function weekdayShort(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** Short day names for the day strip, taken from the server's own day grouping. */
export function dayLabels(plan: PlanResult): string[] {
  return plan.days.map((day, index) => (index === 0 ? "Bugün" : weekdayShort(day.date)));
}

/** Conditions right now, or null when the forecast does not reach the present. */
export function currentHour(plan: PlanResult): ScoredHour | null {
  // Null *or* absent: the field is optional in the schema, and the server omits it
  // rather than sending null when the forecast does not reach the present.
  const index = plan.now_index;
  if (index === null || index === undefined) return null;
  return plan.hours[index] ?? null;
}

/** Which day the current hour falls in, for opening the trace where the person is. */
export function currentDayIndex(plan: PlanResult): number {
  const now = currentHour(plan);
  if (!now) return 0;
  const index = plan.days.findIndex((d) => d.date === now.hour_utc.slice(0, 10));
  return index >= 0 ? index : 0;
}

/** "Cumartesi 06:00–11:00" — the verdict, which is a span rather than a number. */
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export function formatWindowDay(window: WritableWindow): string {
  const [year, month, day] = window.day.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function formatWindowSpan(window: WritableWindow): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(window.start_hour)}:00–${pad(window.end_hour)}:00`;
}

/** "14 dk önce" — staleness has to be visible, so it is never hidden behind a tooltip. */
export function formatAge(fetchedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 60000));
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.round(hours / 24)} gün önce`;
}
