# ADR-0016 — The device caches the scored plan, not the raw forecast

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

The application needed to open without a reachable server. Until now every launch made a
live `/plan` request, and a phone out of signal — or a laptop that was not running —
produced a screen that could say nothing at all.

[doc 12](../12-data-model.md) had already specified the device store, and named
`ForecastHour` as a table held "identically on both sides, never synced". Building it
turned out to be impossible without breaking something else.

A `ForecastHour` row is raw weather: temperature, wind, precipitation probability, a WMO
code. The trace screen does not draw any of that. It draws a **comfort score per hour**
for a chosen profile, and the windows that clear it. Turning one into the other is the
scoring engine — which is deliberately not on the client:

- [ADR-0007](./ADR-0007-deterministic-scoring-engine.md) puts scoring in tested Python,
  precisely so that a number a user sees has one implementation.
- [doc 02](../02-mobile-stack.md) states it as a rule for the mobile layer: no business
  logic, because rules duplicated in TypeScript "would quietly diverge".

So a device cache of `ForecastHour` is one of two things. Either it is unusable — rows the
client cannot turn into a screen — or it comes with a TypeScript port of the scoring
engine, which is the divergence both documents exist to prevent. There is no third
reading, and the two documents cannot both be followed.

The measurement that made the size question moot: a real seven-day `/plan` response for
İstanbul is **38,944 bytes** of JSON, for 168 scored hours. Caching the scored response
rather than the raw hours costs no meaningful storage, because it *is* the raw hours plus
a score per hour.

## Decision

The device caches the **`/plan` response** — already scored, as it arrived — keyed by
location and by the profile's limits. `ForecastHour` is not stored on the device; the
table in doc 12 applies to the server only.

## Consequences

**Positive**

- The app opens and draws a trace with no server, no network, and no model.
- The scoring engine stays in one place, tested, with one implementation of every number
  a person sees. ADR-0007 and doc 02 are upheld rather than traded against each other.
- The cache is honestly disposable. It holds derived data that is always re-fetchable, so
  a migration that cannot be made safe may drop it — the rule doc 12 already sets for
  caches, now with nothing in it that could not be rebuilt.
- Staleness is already carried: the response has `fetched_at`, and doc 10 requires the
  trace to desaturate and keep its timestamp rather than hide it.

**Negative**

- **The cache is per profile, not per location.** Two profiles over the same forecast are
  two cached responses of ~39 KB, where one `ForecastHour` set plus client scoring would
  have been one. Editing a profile's limits invalidates its entry entirely.
- **An offline device cannot answer a question it has not asked before.** Adding a profile
  or changing a limit needs the server, where a raw forecast cache plus a local engine
  could have scored it on the spot. This is the real cost, and it is paid to keep the
  engine singular.
- **Nothing offline is recomputed as time passes.** A cached plan's `now_index` was
  resolved by the server when it was fetched, so an offline app several hours later is
  pointing at the wrong hour until it can refresh. It is shown as stale, which is honest,
  but it is not correct.
- Doc 12's entity list is now wrong about `ForecastHour` on the device and is corrected
  there.

## Alternatives considered

| Option | Why not |
|---|---|
| `ForecastHour` on the device, scored in TypeScript | The best option on paper: one cache serving every profile, offline scoring of profiles never sent to the server, and the smallest storage footprint. Rejected because it puts a second implementation of the scoring engine in the product. ADR-0007 exists because a number a user sees must come from one tested place, and two engines drift silently — the client would be wrong in a way no server test could catch. |
| `ForecastHour` on the device, scored by asking the server | Keeps one engine and a compact cache, and would let the client re-score without re-fetching weather. Rejected because it needs a server to be useful, which is the entire problem being solved. |
| A generic TanStack Query persister | Least code by a wide margin, and it would cover every query rather than just this one. Rejected because it serialises the whole query cache as a single blob, which cannot be pruned per entry — doc 12 already records that `ForecastHour` retention is unsolved, and this would make a ceiling impossible rather than merely absent. |
| No device cache; require a server | What shipped until now, and defensible for a self-hosted app whose server is usually a laptop on the same network. Rejected because "the app is blank when your laptop is asleep" is a product answer nobody accepts, and the fix is small. |

## When to revisit

If profiles ever need to be scored offline — a plausible request the moment someone edits
a limit on a train — this decision is the thing blocking it, and the honest response is a
new ADR that moves the engine rather than a quiet TypeScript copy of it.

## Open question

Retention. The cache needs a ceiling, and this ADR sets one by count rather than by size
or age because count is the only one that can be enforced without measuring every row. The
right number is unknown; twelve entries is a guess, not a finding.
