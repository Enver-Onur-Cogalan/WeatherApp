/**
 * The device database, opened once.
 *
 * `openDatabaseSync` at module scope rather than inside a provider: SQLite here is a file
 * handle, not a service, and threading a context through every caller buys nothing when
 * there is exactly one database for the life of the process.
 *
 * Migrations run through `useMigrations` in the root layout, before the first query.
 * docs/12 is strict about this half being the harder one — an installed app holds a
 * database written by an older version, and a failed migration on someone's phone is not
 * a migration you can go and fix. Forward-only, idempotent, and never destructive to
 * user-owned data; a cache may be dropped and re-fetched, profiles never may.
 */

import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

import * as schema from "@/db/schema";

const sqlite = openDatabaseSync("weatherapp.db", { enableChangeListener: true });

export const db = drizzle(sqlite, { schema });
export { schema };
