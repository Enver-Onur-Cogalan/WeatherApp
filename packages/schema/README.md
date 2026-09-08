# @weatherapp/schema

One definition, three consumers.

`schemas/*.json` are the JSON Schema documents for everything that crosses a boundary.
They are generated into **Pydantic** models for the service, **Zod** schemas for the
mobile client, and handed **verbatim to Ollama** as the `format` parameter for
constrained decoding.

That third consumer is the reason this package exists. If the API contract and the
model's output contract were written separately they would drift, and the drift would
show up as a validation failure in production rather than a type error at build time.

## The drift can come from the generator, and once did

One definition is not enough on its own: the two consumers also have to be generated
*faithfully*, and on 2026-09-08 they were not.

The generator applied the constraints of a **field** and never those of an **array's
items**. So this:

```json
{ "type": "array", "items": { "type": "string", "maxLength": 200 }, "maxItems": 4 }
```

produced `z.array(z.string().max(200)).max(4)` for the client and `list[str]` with
`max_length=4` for the server. One definition, two different contracts — the precise
failure this package exists to prevent, arriving through the tool meant to prevent it.

The server was therefore free to emit a 300-character warning that its own schema
forbade, and once the model was asked for advice ([ADR-0017](../../docs/adr/ADR-0017-assistant-that-advises.md))
it did. The client refused to parse it.

**The symptom appeared on the wrong side of the wire.** A phone reported that the server
was unreachable while the server's log recorded the same request as a success, with a
real answer in 21.8 seconds. Nothing named the field, because the client's streaming path
had classified a schema error as a network failure and discarded the original. It cost an
evening, and the fix that found it was making the error say what it was.

The same gap had quietly dropped a second rule nobody had run into: `preferred_hours`
declared its items to be hours of a day, and the server accepted 99.

Item constraints now cross through `Annotated`, and `services/api/tests/test_agent.py`
asserts that the cap on a warning exists **on the server side too** rather than only in
the JSON. That test is the guard: a generator that silently drops a rule cannot be caught
by reading the schema, only by asking the generated model what it believes.

The lesson worth keeping is narrower than "test the generator". It is that a contract
shared by two consumers needs a check that reads it back from *each* of them, because the
document they were both generated from will always look correct.

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
