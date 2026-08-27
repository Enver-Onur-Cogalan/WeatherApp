# @weatherapp/schema

One definition, three consumers.

`schemas/*.json` are the JSON Schema documents for everything that crosses a boundary.
They are generated into **Pydantic** models for the service, **Zod** schemas for the
mobile client, and handed **verbatim to Ollama** as the `format` parameter for
constrained decoding.

That third consumer is the reason this package exists. If the API contract and the
model's output contract were written separately they would drift, and the drift would
show up as a validation failure in production rather than a type error at build time.

## Generating

```bash
npm run schema          # from the repository root
```

Writes `generated/*.ts` (Zod) and `../../services/api/app/schemas/*.py` (Pydantic).
Both are committed, so neither consumer needs this package's toolchain to build.

## Changing a schema

Edit the JSON, regenerate, and commit all three. A schema change that only lands in one
consumer is the exact failure this package was built to prevent.

Anything that does not cross a boundary does not belong here — `RefreshToken` is
server-only, `AskExchange` never leaves the device.
