/**
 * The assistant's history, on the device.
 *
 * Device-only and never uploaded (docs/12). What someone asks an assistant is more
 * revealing than what profiles they keep, and this is the one table whose contents never
 * leave the phone even when an account exists.
 *
 * Capped at twenty, oldest evicted — docs/11's number, and its reasoning: enough to scroll
 * back through a week of questions, "not enough to become a chat app with a retention
 * policy".
 */

import { desc, eq, notInArray } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { db, schema } from "@/db/client";
import type { AskResponse, Exchange } from "@/lib/ask";

/**
 * docs/11's number, and its reasoning: enough to scroll back through a week of
 * questions, "not enough to become a chat app with a retention policy".
 *
 * Exported because the screen says it out loud. At two or three questions a day the cap
 * is reached in about a week, and after that every new question silently drops the
 * oldest — which a person who has been using the app for a month has no way to know.
 */
export const KEEP = 20;

export function useExchanges(): Exchange[] {
  const { data } = useLiveQuery(
    db
      .select()
      .from(schema.askExchanges)
      .orderBy(desc(schema.askExchanges.createdAt))
      .limit(KEEP),
  );

  return (data ?? [])
    .map((row) => {
      try {
        return {
          id: row.id,
          question: row.question,
          response: JSON.parse(row.responseJson) as AskResponse,
          createdAt: row.createdAt,
        };
      } catch {
        // A row written by an older version whose shape has since changed. Dropped from
        // the list rather than crashing the screen: history is disposable in a way
        // profiles are not, which is exactly the distinction docs/12 draws.
        return null;
      }
    })
    .filter((exchange): exchange is Exchange => exchange !== null)
    .reverse(); // Oldest first, because the thread reads downward.
}

/**
 * Write an exchange, at an id the caller chose.
 *
 * An upsert rather than an insert, because editing a question replaces the turn it belongs
 * to rather than adding one below it. The id is the caller's so that a row can be shown as
 * loading in place while its replacement is being fetched — a new id each time would leave
 * the old answer on screen beside the new one.
 *
 * `createdAt` is preserved on a replacement, or the edited turn would jump to the bottom
 * of a thread ordered by it.
 */
export async function recordExchange(
  id: string,
  question: string,
  response: AskResponse,
): Promise<void> {
  const existing = await db
    .select({ createdAt: schema.askExchanges.createdAt })
    .from(schema.askExchanges)
    .where(eq(schema.askExchanges.id, id));

  const row = {
    id,
    question,
    responseJson: JSON.stringify(response),
    createdAt: existing[0]?.createdAt ?? new Date().toISOString(),
  };

  await db
    .insert(schema.askExchanges)
    .values(row)
    .onConflictDoUpdate({ target: schema.askExchanges.id, set: row });

  await evictOld();
}

export async function forgetExchange(id: string): Promise<void> {
  await db.delete(schema.askExchanges).where(eq(schema.askExchanges.id, id));
}

/**
 * Keep the newest twenty.
 *
 * A subquery rather than counting first and deleting second: the count and the delete
 * would be two statements with a gap between them, and the gap is where a concurrent
 * insert makes the cap wrong.
 */
async function evictOld(): Promise<void> {
  const keep = db
    .select({ id: schema.askExchanges.id })
    .from(schema.askExchanges)
    .orderBy(desc(schema.askExchanges.createdAt))
    .limit(KEEP);

  await db.delete(schema.askExchanges).where(notInArray(schema.askExchanges.id, keep));
}
