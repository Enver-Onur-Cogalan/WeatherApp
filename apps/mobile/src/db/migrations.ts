/**
 * The generated migrations, re-exported with a type.
 *
 * `drizzle/migrations.js` is emitted by `drizzle-kit generate`. Its inferred type is
 * wide, so the shape is asserted once here rather than at every call site.
 *
 * Regenerate with `npm run db:generate` after changing `src/db/schema.ts`. The output is
 * committed: a phone has no drizzle-kit, and the SQL has to be in the bundle.
 */

import generated from "../../drizzle/migrations";

const migrations = generated as {
  journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
  migrations: Record<string, string>;
};

export default migrations;
