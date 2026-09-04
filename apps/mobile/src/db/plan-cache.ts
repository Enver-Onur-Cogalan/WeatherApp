/**
 * The last plan for a question, kept on the device.
 *
 * ADR-0016: what is cached is the *scored* response, not the raw forecast. The client
 * cannot turn a `ForecastHour` into a trace without a second copy of the scoring engine,
 * and ADR-0007 exists so that a number a person sees has exactly one implementation.
 *
 * Reads are synchronous. `expo-sqlite`'s sync API answers within the frame, and a plan
 * that arrives one render later is a plan the screen has already drawn an empty state
 * for — the whole point is that the app opens with something on it.
 */

import { desc, eq, notInArray } from "drizzle-orm";

import { db, schema } from "@/db/client";
import type { ActivityProfile, PlanResult } from "@/lib/plan";

/**
 * How many questions stay answerable offline.
 *
 * A guess, and ADR-0016 says so. Twelve is four profiles across three locations, which is
 * more than a household-scale app is likely to hold and about half a megabyte at the
 * measured 39 KB per entry.
 */
const KEEP = 12;

/**
 * Two decimals, about a kilometre (docs/12).
 *
 * The server rounds the same way for its own cache, so neighbours share an entry and a
 * few metres of GPS drift does not miss it. Rounding here as well means the device and
 * the server agree on what counts as the same place.
 */
export function locationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

/**
 * The full key: where, and under what limits.
 *
 * The limits are part of it because the answer is scored against them — the same forecast
 * produces a different trace for a runner and for a picnic. Field order is fixed rather
 * than taken from `Object.keys`, which would make the key depend on how the object
 * happened to be built.
 */
export function planKey(
  latitude: number,
  longitude: number,
  constraints: ActivityProfile,
): string {
  const [from, to] = constraints.preferred_hours;
  return [
    locationKey(latitude, longitude),
    constraints.activity,
    constraints.temp_min,
    constraints.temp_max,
    constraints.wind_max_kmh,
    constraints.precip_max_pct,
    constraints.uv_max ?? "-",
    from,
    to,
  ].join("|");
}

export function readPlan(key: string): PlanResult | null {
  const row = db
    .select()
    .from(schema.planCache)
    .where(eq(schema.planCache.key, key))
    .get();

  if (row === undefined) return null;

  try {
    return JSON.parse(row.payload) as PlanResult;
  } catch {
    // Written by a version whose shape has since changed. A cache is disposable in a way
    // profiles are not (docs/12), so this is dropped rather than repaired.
    db.delete(schema.planCache).where(eq(schema.planCache.key, key)).run();
    return null;
  }
}

export function writePlan(
  key: string,
  locationOf: string,
  plan: PlanResult,
): void {
  const row = {
    key,
    locationKey: locationOf,
    payload: JSON.stringify(plan),
    fetchedAt: plan.fetched_at,
  };

  db.insert(schema.planCache)
    .values(row)
    .onConflictDoUpdate({ target: schema.planCache.key, set: row })
    .run();

  prune();
}

/** Keep the newest `KEEP` entries, in one statement so no gap can make the cap wrong. */
function prune(): void {
  const keep = db
    .select({ key: schema.planCache.key })
    .from(schema.planCache)
    .orderBy(desc(schema.planCache.fetchedAt))
    .limit(KEEP);

  db.delete(schema.planCache).where(notInArray(schema.planCache.key, keep)).run();
}
