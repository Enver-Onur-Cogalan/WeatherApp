/**
 * What the device stores.
 *
 * Not the server's schema, and docs/12 is emphatic about why: the two stores hold
 * overlapping but different things, and pretending otherwise is how sync bugs start.
 * Three differences matter here.
 *
 * **`user_id` really is nullable.** On the server a guest has no rows at all; here a
 * guest's profiles are the normal case, and they have no owner until an account exists to
 * attach them to (ADR-0009).
 *
 * **Timestamps are text, not integers.** They cross the wire as RFC 3339 strings and are
 * compared as strings for last-write-wins, so storing them as epoch milliseconds would
 * mean converting twice on every read and write for no benefit. ISO-8601 in UTC sorts
 * lexicographically, which is the only ordering property this needs.
 *
 * **`ask_exchanges` exists only here and never syncs.** docs/12 caps it at twenty rows,
 * oldest evicted. It is not in `packages/schema` because it never crosses the wire.
 *
 * **There is no `ForecastHour` table**, though docs/12's entity list once named one. The
 * device caches the *scored* plan instead, because it cannot score a raw forecast without
 * a second copy of the engine — see ADR-0016.
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const savedProfiles = sqliteTable(
  "saved_profiles",
  {
    // UUIDv7, generated here (ADR-0015). The same id the server will use, so signing up
    // uploads what exists rather than renumbering it.
    id: text("id").primaryKey(),

    /** Null while these belong to nobody — the guest case, which is the common one. */
    userId: text("user_id"),

    name: text("name").notNull(),
    activity: text("activity").notNull(),

    tempMin: integer("temp_min").notNull(),
    tempMax: integer("temp_max").notNull(),
    windMaxKmh: integer("wind_max_kmh").notNull(),
    precipMaxPct: integer("precip_max_pct").notNull(),
    uvMax: integer("uv_max"),

    // SQLite has no array type. Two columns rather than a JSON string, because they are
    // read on every request and a string would have to be parsed and re-validated each
    // time; the pair is kept honest by the code that writes it, which is the same code
    // that reads it.
    preferredFrom: integer("preferred_from").notNull(),
    preferredTo: integer("preferred_to").notNull(),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),

    /**
     * Set when this row differs from what the server has, or has never been sent.
     *
     * The queue ADR-0015 describes, in one column. A guest's rows are all pending by
     * definition — there is nowhere to send them — and become the payload the moment an
     * account exists.
     */
    pending: integer("pending", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("ix_saved_profiles_user").on(table.userId)],
);

export const askExchanges = sqliteTable(
  "ask_exchanges",
  {
    id: text("id").primaryKey(),
    question: text("question").notNull(),

    // The whole `AskResponse`, as it arrived. Stored rather than picked apart because
    // nothing queries inside it — the screen renders it and that is all.
    responseJson: text("response_json").notNull(),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [index("ix_ask_exchanges_created").on(table.createdAt)],
);


export const planCache = sqliteTable(
  "plan_cache",
  {
    /** Location and limits together: the same question always hits the same row. */
    key: text("key").primaryKey(),

    /** Rounded `lat,lon` to two decimals — about a kilometre, so neighbours share
     *  an entry (docs/12). Kept as its own column so a location can be evicted whole. */
    locationKey: text("location_key").notNull(),

    /** The `PlanResult` exactly as it arrived. Not picked apart: nothing queries inside
     *  it, and re-deriving the shape here would be a second place for it to drift. */
    payload: text("payload").notNull(),

    /** When the server produced it, copied out of the payload so eviction can order by
     *  it without parsing every row. */
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [index("ix_plan_cache_fetched").on(table.fetchedAt)],
);
