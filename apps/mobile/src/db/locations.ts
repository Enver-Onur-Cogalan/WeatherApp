/**
 * Places on the device.
 *
 * The same shape as `db/profiles.ts` and for the same reason: a guest's places have to
 * work, and the screen that edits them must not care which store it is talking to.
 *
 * Coordinates are text here and `numeric(8,5)` on the server, both exact. A float would
 * round-trip 41.0082 as 41.008199999 and a last-write-wins comparison would then see an
 * edit where nobody made one.
 */

import { desc, eq, isNull } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { db, schema } from "@/db/client";
import type { SavedLocation } from "@/lib/locations";

type Row = typeof schema.savedLocations.$inferSelect;

export function toLocation(row: Row): SavedLocation {
  return {
    id: row.id,
    label: row.label,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
    is_current: row.isCurrent,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toRow(location: SavedLocation): Row {
  return {
    id: location.id,
    userId: null,
    label: location.label,
    // Five decimals, about a metre — the precision docs/12 asks for, fixed so the string
    // is stable rather than however JavaScript chose to print the float this time.
    latitude: location.latitude.toFixed(5),
    longitude: location.longitude.toFixed(5),
    timezone: location.timezone,
    isCurrent: location.is_current ?? false,
    sortOrder: location.sort_order ?? 0,
    createdAt: location.created_at,
    updatedAt: location.updated_at,
    pending: true,
  };
}

/**
 * The device's places, and whether they have actually been read yet.
 *
 * `loaded` is not decoration. `useLiveQuery` returns `undefined` on the first render, and
 * a caller that treats that as "no places" concludes there is no current location — which
 * is how `useCurrentLocation` came to write a *new* record on every launch instead of
 * updating the one it already had. An empty list and an unread list are different
 * answers, and this is what lets a caller tell them apart.
 */
export function useLocalLocations(): { locations: SavedLocation[]; loaded: boolean } {
  const { data } = useLiveQuery(
    db
      .select()
      .from(schema.savedLocations)
      .where(isNull(schema.savedLocations.userId))
      .orderBy(desc(schema.savedLocations.createdAt)),
  );

  return { locations: (data ?? []).map(toLocation), loaded: data !== undefined };
}

export async function saveLocalLocation(location: SavedLocation): Promise<void> {
  const row = toRow(location);
  await db
    .insert(schema.savedLocations)
    .values(row)
    .onConflictDoUpdate({ target: schema.savedLocations.id, set: row });
}

export async function deleteLocalLocation(id: string): Promise<void> {
  await db.delete(schema.savedLocations).where(eq(schema.savedLocations.id, id));
}
