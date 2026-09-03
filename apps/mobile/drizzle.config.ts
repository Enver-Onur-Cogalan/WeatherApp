import type { Config } from "drizzle-kit";

/**
 * Migration generation for the device database.
 *
 * `driver: "expo"` makes drizzle-kit emit a `migrations.js` alongside the SQL, which is
 * what lets the migrations be bundled into the app — a phone has no filesystem to read
 * `.sql` files from at launch.
 *
 * docs/12: forward-only, run before the first query, and every migration idempotent and
 * non-destructive to user-owned data. A failed migration on someone's phone is not one
 * you can go and fix.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "expo",
} satisfies Config;
