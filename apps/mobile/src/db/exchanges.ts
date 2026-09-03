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
import { uuidv7 } from "@/lib/uuid";

const KEEP = 20;

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

export async function recordExchange(
  question: string,
  response: AskResponse,
): Promise<void> {
  await db.insert(schema.askExchanges).values({
    id: uuidv7(),
    question,
    responseJson: JSON.stringify(response),
    createdAt: new Date().toISOString(),
  });

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
