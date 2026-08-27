/**
 * Plan data for the trace.
 *
 * Currently read from a recorded `/plan` response so the screen can be built and
 * judged without a running backend. The shape is the real one — the fixture was
 * produced by the actual endpoint — so swapping in a fetch later changes where the
 * data comes from and nothing else.
 */

import fixture from "@/fixtures/plan.json";

export type ScoredHour = {
  hour_utc: string;
  local_hour: number;
  score: number;
  excluded: boolean;
  worst_penalty: string | null;
  temperature_c: number;
  precip_prob_pct: number;
  wind_kmh: number;
  uv_index: number;
  cloud_cover_pct: number;
  weather_code: number;
};

export type Window = {
  day: string;
  start_hour: number;
  end_hour: number;
  score: number;
  length_hours: number;
};

export type DaySummary = {
  date: string;
  temp_min_c: number;
  temp_max_c: number;
  weather_code: number;
  precip_prob_max_pct: number;
};

export type PlanResult = {
  latitude: number;
  longitude: number;
  timezone: string;
  fetched_at: string;
  stale: boolean;
  hours: ScoredHour[];
  windows: Window[];
  days: DaySummary[];
  /** The hour happening now, resolved by the server so the client never handles the
   *  location's timezone. Null when the forecast does not cover it. */
  now_index: number | null;
  blocker: { constraint: string; hours: number } | null;
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

const PLANS = fixture as unknown as Record<ActivityKey, PlanResult>;

export function getPlan(activity: ActivityKey): PlanResult {
  return PLANS[activity];
}

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
  if (plan.now_index === null) return null;
  return plan.hours[plan.now_index] ?? null;
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

export function formatWindowDay(window: Window): string {
  const [year, month, day] = window.day.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function formatWindowSpan(window: Window): string {
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
