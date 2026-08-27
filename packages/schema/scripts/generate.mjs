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

/** Resolve a local `$ref` against the document's `$defs`. */
function deref(node, root) {
  if (!node?.$ref) return node;
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

function zodFor(node, root, defs) {
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
    if (resolved.format === "date-time") out += ".datetime()";
  } else if (type === "integer" || type === "number") {
    out = type === "integer" ? "z.number().int()" : "z.number()";
    if (resolved.minimum !== undefined) out += `.min(${resolved.minimum})`;
    if (resolved.maximum !== undefined) out += `.max(${resolved.maximum})`;
  } else if (type === "boolean") {
    out = "z.boolean()";
  } else if (type === "array") {
    out = `z.array(${zodFor(resolved.items, root, defs)})`;
    if (resolved.minItems !== undefined) out += `.min(${resolved.minItems})`;
    if (resolved.maxItems !== undefined) out += `.max(${resolved.maxItems})`;
  } else if (type === "object") {
    const required = new Set(resolved.required ?? []);
    const fields = Object.entries(resolved.properties ?? {}).map(([name, prop]) => {
      const inner = zodFor(prop, root, defs);
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
  const body = zodFor(schema, schema, schema.$defs ?? {});
  const doc = schema.description ? `/** ${schema.description} */\n` : "";
  return [
    BANNER_TS,
    'import { z } from "zod";',
    "",
    `${doc}export const ${name} = ${body};`,
    "",
    `export type ${name} = z.infer<typeof ${name}>;`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------ Pydantic

function pyType(node, root, extraModels) {
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
    out = `list[${pyType(resolved.items, root, extraModels)}]`;
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

function pyField(name, node, root, required, extraModels) {
  const resolved = deref(node, root);
  const annotation = pyType(node, root, extraModels);
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
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties ?? {}).map(([field, prop]) =>
    pyField(field, prop, schema, required.has(field), extraModels),
  );

  const nested = [...extraModels.entries()].map(([modelName, node]) => {
    const nestedRequired = new Set(node.required ?? []);
    const inner = Object.entries(node.properties ?? {}).map(([field, prop]) =>
      pyField(field, prop, schema, nestedRequired.has(field), new Map()),
    );
    return [`class ${modelName}(BaseModel):`, `    model_config = ConfigDict(extra="forbid")`, "", ...inner, ""].join("\n");
  });

  const doc = schema.description ? `    """${schema.description}"""\n` : "";
  const body = [...nested, `class ${name}(BaseModel):`, ...fields].join("\n");
  // Only import what the output actually uses — an unused import is a lint error in
  // generated code, which is a generator bug rather than something to exclude.
  const needsLiteral = body.includes("Literal[");
  return [
    BANNER_PY,
    "",
    "from __future__ import annotations",
    "",
    ...(needsLiteral ? ["from typing import Literal", ""] : []),
    "from pydantic import BaseModel, ConfigDict, Field",
    "",
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

console.log(`\n${files.length} schema(s) generated.`);
