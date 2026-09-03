/**
 * Profiles on the device.
 *
 * This is what makes guest mode real rather than a demo: before it, a guest got three
 * constants they could not change, and "everything works without an account" was only
 * true for the parts that needed no storage.
 *
 * The row shape is the device's, and the wire shape is `packages/schema`'s. Converting
 * between them lives here, in one direction each, because a conversion scattered across
 * callers is how the two drift.
 */

import { desc, eq, isNull } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { db, schema } from "@/db/client";
import type { ActivityProfile } from "@/lib/plan";
import type { SavedProfile } from "@/lib/profiles";
import { uuidv7 } from "@/lib/uuid";

type Row = typeof schema.savedProfiles.$inferSelect;

/** A stored row as the rest of the app talks about profiles. */
export function toProfile(row: Row): SavedProfile {
  return {
    id: row.id,
    name: row.name,
    constraints: {
      activity: row.activity as ActivityProfile["activity"],
      temp_min: row.tempMin,
      temp_max: row.tempMax,
      wind_max_kmh: row.windMaxKmh,
      precip_max_pct: row.precipMaxPct,
      uv_max: row.uvMax,
      preferred_hours: [row.preferredFrom, row.preferredTo],
    },
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toRow(profile: SavedProfile, pending = true): Row {
  const [from, to] = profile.constraints.preferred_hours;
  return {
    id: profile.id,
    userId: null,
    name: profile.name,
    activity: profile.constraints.activity,
    tempMin: profile.constraints.temp_min,
    tempMax: profile.constraints.temp_max,
    windMaxKmh: profile.constraints.wind_max_kmh,
    precipMaxPct: profile.constraints.precip_max_pct,
    uvMax: profile.constraints.uv_max ?? null,
    preferredFrom: from,
    preferredTo: to,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    pending,
  };
}

/**
 * The guest's profiles, re-rendering when they change.
 *
 * `useLiveQuery` subscribes to the table, so an edit made anywhere in the app reaches
 * every screen showing it without an invalidation step to forget.
 */
export function useLocalProfiles(): SavedProfile[] {
  const { data } = useLiveQuery(
    db
      .select()
      .from(schema.savedProfiles)
      .where(isNull(schema.savedProfiles.userId))
      .orderBy(desc(schema.savedProfiles.createdAt)),
  );

  return (data ?? []).map(toProfile);
}

export async function saveLocalProfile(profile: SavedProfile): Promise<void> {
  const row = toRow(profile);
  await db
    .insert(schema.savedProfiles)
    .values(row)
    // The client owns the id, so every write is an upsert — the same rule as the server,
    // and what makes a retry harmless rather than a duplicate (ADR-0015).
    .onConflictDoUpdate({ target: schema.savedProfiles.id, set: row });
}

export async function deleteLocalProfile(id: string): Promise<void> {
  // docs/12: no soft delete, no tombstone, on either side.
  await db.delete(schema.savedProfiles).where(eq(schema.savedProfiles.id, id));
}

/**
 * Copy the built-in defaults into the device database.
 *
 * Called once, when a guest has no profiles at all. Without this the first thing a new
 * guest sees on the profiles screen is an empty list, and the three sensible starting
 * points the app already knows about would be thrown away.
 */
export async function seedLocalProfiles(
  defaults: { label: string; constraints: ActivityProfile }[],
): Promise<void> {
  const now = new Date().toISOString();
  for (const preset of defaults) {
    await saveLocalProfile({
      id: uuidv7(),
      name: preset.label,
      constraints: preset.constraints,
      created_at: now,
      updated_at: now,
    });
  }
}
