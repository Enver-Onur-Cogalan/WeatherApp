/**
 * The generated Zod schemas, against responses the API actually produced.
 *
 * The CI job next to this one regenerates the package and fails if the output changed —
 * which proves the generated files match the JSON Schemas, and nothing at all about
 * whether either matches reality. A defect that slipped through exactly that gap is why
 * this exists: `format: "date-time"` was generated as Zod's bare `.datetime()`, which
 * accepts a trailing `Z` and rejects an offset, while Python's `datetime.isoformat()`
 * writes `+00:00`. Both are valid RFC 3339. The generated schema was internally
 * consistent, regenerated clean, and rejected every real response the server sent.
 *
 * So the fixtures here are recordings, captured from a running backend and committed.
 * They make the round trip checkable on a runner with no server, no database and no
 * model — which is the only reason it can run on every push.
 *
 * Recapture with the server up:
 *
 *     curl -s -X POST localhost:8000/plan -H 'Content-Type: application/json' \
 *       -d @packages/schema/fixtures/plan-request.example.json
 *
 * The generated files are TypeScript with extensionless imports, which Node will not
 * resolve, so they are compiled to a temporary directory first. That is a wart of
 * checking a source-only package rather than a sign the package is wrong: Metro and
 * `tsc` both consume it directly, which is what it is for.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
// Inside the package rather than in the system temp directory: the compiled schemas
// `require("zod")`, and Node resolves that by walking up from the file's own location.
// A build in /tmp walks up to /, finds nothing, and fails for a reason that has nothing
// to do with the contract.
const build = path.join(root, ".contract-build");
fs.rmSync(build, { recursive: true, force: true });

/** Each recording, and the schema it has to satisfy. */
const CASES = [
  { fixture: "plan-result.json", schema: "plan-result.js", export: "PlanResult" },
  { fixture: "ask-response.json", schema: "ask-response.js", export: "AskResponse" },
];

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "--ignoreConfig",
      ...fs.readdirSync(path.join(root, "generated")).map((f) => path.join(root, "generated", f)),
      "--outDir",
      build,
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--ignoreDeprecations",
      "6.0",
      "--target",
      "es2020",
      "--skipLibCheck",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );

  // The package itself is `"type": "module"`, so a `.js` file inside it is ESM — and
  // what tsc just wrote is CommonJS. One package.json marks the build directory as the
  // exception without changing how the package is published or consumed.
  fs.writeFileSync(path.join(build, "package.json"), '{ "type": "commonjs" }\n');

  const require = createRequire(path.join(root, "package.json"));
  let failed = 0;

  for (const testCase of CASES) {
    const schema = require(path.join(build, testCase.schema))[testCase.export];
    const recorded = JSON.parse(
      fs.readFileSync(path.join(root, "fixtures", testCase.fixture), "utf8"),
    );

    const result = schema.safeParse(recorded);
    if (result.success) {
      console.log(`ok    ${testCase.export} accepts ${testCase.fixture}`);
      continue;
    }

    failed += 1;
    console.error(`FAIL  ${testCase.export} rejects ${testCase.fixture}`);
    for (const issue of result.error.issues.slice(0, 6)) {
      console.error(`        ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  console.log(`\n${CASES.length - failed}/${CASES.length} recorded responses validate`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  fs.rmSync(build, { recursive: true, force: true });
}
