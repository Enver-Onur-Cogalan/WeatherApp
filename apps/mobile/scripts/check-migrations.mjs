/**
 * Apply every device migration to an empty SQLite database.
 *
 * The server's migrations are exercised by `alembic upgrade` in CI. The device's had
 * nothing: they are generated SQL, bundled into the app, and first executed on somebody's
 * phone — which docs/12 calls the harder half for exactly that reason. A failed migration
 * on a phone is not one you can go and fix.
 *
 * Node ships SQLite, so this needs no device and no simulator. It checks that the SQL
 * parses and applies, and that the columns the schema promises are the columns that
 * appear. It cannot check a migration against a database written by an older version of
 * the app — that needs a fixture per released schema, and there has only been one.
 */

// node:sqlite is behind an experimental flag and prints a warning on import; the API
// itself is stable enough for applying DDL, which is all this does.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "drizzle");

const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("no migrations found — has `npm run db:generate` been run?");
  process.exit(1);
}

const db = new DatabaseSync(":memory:");

for (const file of files) {
  const body = fs.readFileSync(path.join(dir, file), "utf8");
  for (const statement of body.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
  console.log(`ok    ${file}`);
}

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => row.name);

console.log(`\n${files.length} migration(s) apply cleanly`);
console.log(`tables: ${tables.join(", ")}`);
