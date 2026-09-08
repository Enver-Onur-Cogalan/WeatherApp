#!/usr/bin/env node
/**
 * Generate typed models from the JSON Schema documents in `../schemas`.
 *
 * Two outputs, one source:
 *   generated/*.ts                     Zod schemas for the mobile client
 *   services/api/app/schemas/*.py      Pydantic models for the service
 *
 * The same JSON is also handed to Ollama as the `format` parameter, which is why the
 * schemas live here rather than being written twice — see packages/schema/README.md.
 *
 * Deliberately dependency-free. A code generator that needs its own install step is a
 * generator people stop running.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "schemas");
const zodDir = join(here, "..", "generated");
const pydanticDir = join(here, "..", "..", "..", "services", "api", "app", "schemas");

const BANNER_TS = "// Generated from packages/schema/schemas. Do not edit — run `npm run schema`.";
const BANNER_PY = '"""Generated from packages/schema/schemas. Do not edit — run `npm run schema`."""';

const pascal = (s) => s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * Every schema, keyed by `$id`, so one document can reference another instead of
 * repeating it. Populated before any generation runs.
 */
const byId = new Map();

/** True for a `$ref` that points at a different document rather than into this one. */
function isExternal(ref) {
  return typeof ref === "string" && !ref.startsWith("#");
}

/** The exported type name and module stem for an external `$ref`. */
function externalTarget(ref) {
  const target = byId.get(ref.split("#")[0]);
  if (!target) throw new Error(`unknown $ref: ${ref}`);
  return target;
}

/** Resolve a `$ref`: into this document's `$defs`, or into another document. */
function deref(node, root) {
  if (!node?.$ref) return node;
  if (isExternal(node.$ref)) return externalTarget(node.$ref).schema;
  const path = node.$ref.replace(/^#\//, "").split("/");
  return path.reduce((acc, key) => acc[key], root);
}

/** True when a schema's `type` array includes "null". */
function nullable(node) {
  return Array.isArray(node.type) && node.type.includes("null");
}

function baseType(node) {
  return Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
}

// ----------------------------------------------------------------- Zod

function zodFor(node, root, imports) {
  if (isExternal(node?.$ref)) {
    const target = externalTarget(node.$ref);
    imports.add(target);
    return target.name;
  }
  const resolved = deref(node, root);
  const type = baseType(resolved);
  let out;

  if (resolved.enum) {
    out = `z.enum([${resolved.enum.map((v) => JSON.stringify(v)).join(", ")}])`;
  } else if (type === "string") {
    out = "z.string()";
    if (resolved.minLength !== undefined) out += `.min(${resolved.minLength})`;
    if (resolved.maxLength !== undefined) out += `.max(${resolved.maxLength})`;
    if (resolved.pattern) out += `.regex(/${resolved.pattern}/)`;
    // `{ offset: true }` is not optional here. Zod's bare `.datetime()` accepts only a
    // trailing `Z`, while Python's `datetime.isoformat()` — what the API actually
    // returns — writes `+00:00`. Both are valid RFC 3339; the narrower reading rejected
    // every real response, and the client's error for that is "the schema has drifted",
    // which would have been a confusing thing to be told about correct data.
    if (resolved.format === "date-time") out += ".datetime({ offset: true })";
  } else if (type === "integer" || type === "number") {
    out = type === "integer" ? "z.number().int()" : "z.number()";
    if (resolved.minimum !== undefined) out += `.min(${resolved.minimum})`;
    if (resolved.maximum !== undefined) out += `.max(${resolved.maximum})`;
  } else if (type === "boolean") {
    out = "z.boolean()";
  } else if (type === "array") {
    out = `z.array(${zodFor(resolved.items, root, imports)})`;
    if (resolved.minItems !== undefined) out += `.min(${resolved.minItems})`;
    if (resolved.maxItems !== undefined) out += `.max(${resolved.maxItems})`;
  } else if (type === "object") {
    const required = new Set(resolved.required ?? []);
    const fields = Object.entries(resolved.properties ?? {}).map(([name, prop]) => {
      const inner = zodFor(prop, root, imports);
      return `  ${name}: ${required.has(name) ? inner : `${inner}.optional()`},`;
    });
    out = `z.object({\n${fields.join("\n")}\n})`;
    if (resolved.additionalProperties === false) out += ".strict()";
  } else {
    out = "z.unknown()";
  }

  return nullable(resolved) ? `${out}.nullable()` : out;
}

function toZod(schema, name) {
  const imports = new Set();
  const body = zodFor(schema, schema, imports);
  const doc = schema.description ? `/** ${schema.description} */\n` : "";
  return [
    BANNER_TS,
    'import { z } from "zod";',
    ...[...imports].map((t) => `import { ${t.name} } from "./${t.stem}";`),
    "",
    `${doc}export const ${name} = ${body};`,
    "",
    `export type ${name} = z.infer<typeof ${name}>;`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------ Pydantic

function pyType(node, root, extraModels, imports) {
  if (isExternal(node?.$ref)) {
    const target = externalTarget(node.$ref);
    imports.add(target);
    return target.name;
  }
  const resolved = deref(node, root);
  const type = baseType(resolved);
  let out;

  if (resolved.enum) {
    out = resolved.enum.map((v) => JSON.stringify(v)).join(", ");
    out = `Literal[${out}]`;
  } else if (type === "string") {
    out = "str";
  } else if (type === "integer") {
    out = "int";
  } else if (type === "number") {
    out = "float";
  } else if (type === "boolean") {
    out = "bool";
  } else if (type === "array") {
    out = `list[${pyItem(resolved.items, root, extraModels, imports)}]`;
  } else if (type === "object") {
    // A nested object becomes its own model, named after the $ref when there is one.
    const refName = node.$ref ? pascal(node.$ref.split("/").pop()) : null;
    if (refName) {
      extraModels.set(refName, resolved);
      out = refName;
    } else {
      out = "dict[str, object]";
    }
  } else {
    out = "object";
  }

  return nullable(resolved) ? `${out} | None` : out;
}

/**
 * An array's item type, carrying the item's own constraints.
 *
 * `pyField` only ever applied the constraints of the *field*, so an array said everything
 * about its length and nothing about what was in it: `{"type": "array", "items":
 * {"type": "string", "maxLength": 200}}` generated `list[str]` and the 200 disappeared.
 * Zod kept it. One definition therefore produced two different contracts — the precise
 * failure this package exists to prevent — and the server happily emitted a 300-character
 * warning that the client then refused to parse.
 *
 * It cost an evening to find, because the symptom was on the wrong side: the phone said
 * the server was unreachable while the server's own log recorded the answer as sent.
 */
function pyItem(node, root, extraModels, imports) {
  const resolved = deref(node, root);
  const inner = pyType(node, root, extraModels, imports);
  const constraints = [];

  if (resolved.type === "string") {
    const parts = [];
    if (resolved.minLength !== undefined) parts.push(`min_length=${resolved.minLength}`);
    if (resolved.maxLength !== undefined) parts.push(`max_length=${resolved.maxLength}`);
    if (resolved.pattern !== undefined) parts.push(`pattern=${JSON.stringify(resolved.pattern)}`);
    if (parts.length) constraints.push(`StringConstraints(${parts.join(", ")})`);
  } else if (resolved.type === "integer" || resolved.type === "number") {
    const parts = [];
    if (resolved.minimum !== undefined) parts.push(`ge=${resolved.minimum}`);
    if (resolved.maximum !== undefined) parts.push(`le=${resolved.maximum}`);
    if (parts.length) constraints.push(`Field(${parts.join(", ")})`);
  }

  return constraints.length ? `Annotated[${inner}, ${constraints.join(", ")}]` : inner;
}

function pyField(name, node, root, required, extraModels, imports) {
  const resolved = deref(node, root);
  let annotation = pyType(node, root, extraModels, imports);
  // An optional field defaults to None, so its annotation has to admit None — otherwise
  // the generated model declares `int` and hands it `None`, and mypy is right to object.
  if (!required && !annotation.endsWith("| None")) {
    annotation = `${annotation} | None`;
  }
  const constraints = [];
  if (resolved.minimum !== undefined) constraints.push(`ge=${resolved.minimum}`);
  if (resolved.maximum !== undefined) constraints.push(`le=${resolved.maximum}`);
  if (resolved.minLength !== undefined) constraints.push(`min_length=${resolved.minLength}`);
  if (resolved.maxLength !== undefined) constraints.push(`max_length=${resolved.maxLength}`);
  if (resolved.minItems !== undefined) constraints.push(`min_length=${resolved.minItems}`);
  if (resolved.maxItems !== undefined) constraints.push(`max_length=${resolved.maxItems}`);
  if (resolved.description) {
    constraints.push(`description=${JSON.stringify(resolved.description)}`);
  }

  const parts = [];
  if (!required) parts.push("default=None");
  parts.push(...constraints);

  const field = parts.length ? ` = Field(${parts.join(", ")})` : "";
  return `    ${name}: ${annotation}${field}`;
}

function toPydantic(schema, name) {
  const extraModels = new Map();
  const imports = new Set();
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(([field, prop]) =>
    pyField(field, prop, schema, required.has(field), extraModels, imports),
  );

  const nested = [...extraModels.entries()].map(([modelName, node]) => {
    const nestedRequired = new Set(node.required ?? []);
    const inner = Object.entries(node.properties ?? {}).map(([field, prop]) =>
      pyField(field, prop, schema, nestedRequired.has(field), new Map(), imports),
    );
    return [`class ${modelName}(BaseModel):`, `    model_config = ConfigDict(extra="forbid")`, "", ...inner, ""].join("\n");
  });

  const doc = schema.description ? `    """${schema.description}"""\n` : "";
  const body = [...nested, `class ${name}(BaseModel):`, ...fields].join("\n");
  // Only import what the output actually uses — an unused import is a lint error in
  // generated code, which is a generator bug rather than something to exclude.
  const fromTyping = [];
  if (body.includes("Annotated[")) fromTyping.push("Annotated");
  if (body.includes("Literal[")) fromTyping.push("Literal");
  const fromPydantic = ["BaseModel", "ConfigDict", "Field"];
  if (body.includes("StringConstraints(")) fromPydantic.push("StringConstraints");
  return [
    BANNER_PY,
    "",
    "from __future__ import annotations",
    "",
    ...(fromTyping.length ? [`from typing import ${fromTyping.join(", ")}`, ""] : []),
    `from pydantic import ${fromPydantic.join(", ")}`,
    "",
    ...[...imports].map((t) => `from .${snake(t.name)} import ${t.name}`),
    ...(imports.size ? [""] : []),
    "",
    ...nested,
    `class ${name}(BaseModel):`,
    doc + `    model_config = ConfigDict(extra="forbid")`,
    "",
    ...fields,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ run

mkdirSync(zodDir, { recursive: true });
mkdirSync(pydanticDir, { recursive: true });

const files = readdirSync(schemaDir).filter((f) => f.endsWith(".json")).sort();
const exports = [];

// Register every schema before generating any, so a document can reference one that
// has not been written yet — otherwise generation would depend on filename order.
for (const file of files) {
  const schema = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
  const stem = file.replace(".json", "");
  const name = schema.title ?? pascal(stem);
  if (schema.$id) byId.set(schema.$id, { name, stem, schema });
}

for (const file of files) {
  const schema = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
  const name = schema.title ?? pascal(file.replace(".json", ""));
  const stem = file.replace(".json", "");

  writeFileSync(join(zodDir, `${stem}.ts`), toZod(schema, name));
  writeFileSync(join(pydanticDir, `${snake(name)}.py`), toPydantic(schema, name));
  exports.push(`export { ${name} } from "./${stem}";`);
  console.log(`  ${file} → ${stem}.ts, ${snake(name)}.py`);
}

writeFileSync(join(zodDir, "index.ts"), [BANNER_TS, ...exports, ""].join("\n"));
writeFileSync(
  join(pydanticDir, "__init__.py"),
  [BANNER_PY, ""].join("\n"),
);

/**
 * Format the Pydantic output before anyone sees it.
 *
 * The generated files are committed, and CI regenerates them and fails on any diff — so
 * generation has to be idempotent. It was not: this script emitted unformatted Python,
 * a `ruff format` run afterwards reflowed it, and the reformatted version was what got
 * committed. Regenerating then produced a diff every time, on eight files, for reasons
 * that had nothing to do with any schema.
 *
 * `services/api/pyproject.toml` already excludes `app/schemas` from ruff, which is why
 * this went unnoticed — an exclusion does not apply to a path named explicitly on the
 * command line, so a formatting hook reached them anyway. The exclusion says "not our
 * style to police"; the comment above it says "formatted, but not linted". Both are
 * satisfied by formatting them here, once, as part of producing them.
 */
const RUFF = [
  // The service's own virtualenv first: that is the version the API is developed and
  // linted with, and formatting has to agree with it rather than with whatever happens
  // to be installed globally.
  join(here, "..", "..", "..", "services", "api", ".venv", "bin", "ruff"),
  "ruff",
];

const formatted = RUFF.some((ruff) => {
  try {
    execFileSync(ruff, ["format", "--quiet", "--line-length", "96", pydanticDir], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return true;
  } catch {
    return false;
  }
});

if (!formatted) {
  // Loud, because the alternative is output that differs from everyone else's and a CI
  // failure that points at the schemas rather than at the missing tool.
  console.error(
    "\nruff is not on PATH. The Pydantic output is unformatted and will not match what " +
      "is committed. Install it (`uv tool install ruff`) and run this again.",
  );
  process.exit(1);
}

console.log(`\n${files.length} schema(s) generated.`);
