/**
 * Moving a guest's profiles into an account.
 *
 * ADR-0009 calls this the fiddliest part of the feature and the one most likely to
 * harbour bugs, which is fair. Three decisions keep it from being one.
 *
 * **It is offered, never automatic.** The project's stated position is that nothing is
 * stored unless you ask for it — uploading someone's profiles the instant they sign in
 * would contradict the very sentence that justifies guest mode existing. Declining is a
 * real answer, and the offer comes back rather than being lost.
 *
 * **The upload is an insert, not a remap.** Ids were generated on the device (ADR-0015),
 * so a profile keeps the identity it already had. Nothing is renumbered, no mapping table
 * is needed, and the id a person's data has on their phone is the id it has on the server.
 *
 * **Running it twice is harmless.** Every write is a `PUT` to an id the client chose, so
 * a half-finished upload is completed by repeating it rather than duplicated. That is the
 * whole payoff of client-generated ids, and it is what makes a partial failure something
 * to retry rather than something to reconcile.
 *
 * What it deliberately does not do is merge by name. Two profiles called "Koşu" — one on
 * the device, one already in the account — stay two profiles, because they have different
 * ids and different limits, and silently collapsing them would lose whichever the code
 * happened to pick. docs/12 asks for a merge to be *offered*; offering it needs a screen
 * that does not exist yet, and duplicates a person can see and delete are a much smaller
 * problem than an edit that vanished.
 */

import { eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db/client";
import { toProfile } from "@/db/profiles";
import { request } from "@/lib/api";
import { TIMEOUT_MS } from "@/lib/config";
import type { SavedProfile } from "@/lib/profiles";
import { SavedProfile as SavedProfileSchema } from "@weatherapp/schema";

export type Handoff = {
  moved: number;
  failed: number;
};

/** The rows that would move: everything on this device that belongs to nobody yet. */
export async function pendingProfiles(): Promise<SavedProfile[]> {
  const rows = await db
    .select()
    .from(schema.savedProfiles)
    .where(isNull(schema.savedProfiles.userId));
  return rows.map(toProfile);
}

/**
 * Upload the device's profiles and mark them as the account's.
 *
 * The write is attempted for every pending profile, and then **the server is asked what
 * it actually holds**. A row is claimed because it is on the server, not because a
 * particular request returned a particular status.
 *
 * That indirection is not fussiness; it was found by measurement. A retry of an upload
 * that already succeeded returns `409`, because the record carries the same `updated_at`
 * the server already has and last-write-wins treats an equal timestamp as stale. An
 * earlier version read that as failure and left the row pending forever — the offer would
 * never go away, and pressing it would do nothing, repeatedly. The same reading also
 * breaks when the app is killed between a successful `PUT` and the local claim.
 *
 * Asking once at the end is also fewer requests than asking per row, and it distinguishes
 * the other `409` — an id that belongs to a different account — for free: that id does not
 * come back in *this* account's list, so it is correctly still a failure.
 */
export async function moveProfilesToAccount(userId: string): Promise<Handoff> {
  const profiles = await pendingProfiles();
  if (profiles.length === 0) return { moved: 0, failed: 0 };

  for (const profile of profiles) {
    try {
      await request({
        method: "PUT",
        path: `/profiles/${profile.id}`,
        body: {
          name: profile.name,
          constraints: profile.constraints,
          updated_at: profile.updated_at,
        },
        schema: SavedProfileSchema,
        timeoutMs: TIMEOUT_MS.plan,
      });
    } catch {
      // Swallowed on purpose: the listing below decides what landed. A 409 here is
      // usually a record that is already there, which is success wearing an error's
      // status code.
    }
  }

  let onServer: Set<string>;
  try {
    const listed = await request({
      method: "GET",
      path: "/profiles",
      schema: z.array(SavedProfileSchema),
      timeoutMs: TIMEOUT_MS.plan,
    });
    onServer = new Set(listed.map((profile) => profile.id));
  } catch {
    // Without the listing there is no way to know what landed, and claiming on optimism
    // would silently orphan rows. Everything stays pending; the offer remains.
    return { moved: 0, failed: profiles.length };
  }

  let moved = 0;
  for (const profile of profiles) {
    if (!onServer.has(profile.id)) continue;
    await claim(profile.id, userId);
    moved += 1;
  }

  return { moved, failed: profiles.length - moved };
}

/**
 * Mark a row as the account's.
 *
 * It stops appearing as a guest profile — the guest query asks for rows owned by nobody —
 * and stops being a candidate for upload. The row is kept rather than deleted because
 * docs/12 says the device holds a copy once an account exists; deleting it here would
 * make the app unusable offline the moment it stops being a guest.
 *
 * A consequence worth stating: signing out later does not turn these back into guest
 * profiles. They belong to the account now, and resurrecting them for whoever next uses
 * the phone would be the wrong answer to a question about someone else's data.
 */
async function claim(id: string, userId: string): Promise<void> {
  await db
    .update(schema.savedProfiles)
    .set({ userId, pending: false })
    .where(eq(schema.savedProfiles.id, id));
}
