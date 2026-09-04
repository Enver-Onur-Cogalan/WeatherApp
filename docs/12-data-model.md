# 12 — Data Model

What exists, where it lives, and what happens when the two copies disagree.

Two stores hold overlapping but different things: **PostgreSQL** on the server owns
accounts and the data attached to them; **SQLite** on the device owns the cache and a
local copy of everything the user can edit. They are not the same schema, and pretending
otherwise is how sync bugs start.

## Entities

```
User ──┬── ActivityProfile   ──┐
       ├── SavedLocation      ─┤── owned, synced
       ├── NotificationRule   ─┘
       └── RefreshToken         server only

ForecastHour        cache, server only — see ADR-0016
AskExchange         device only, never leaves it
```

### ActivityProfile

The most important table in the project: the language model extracts into it, and the
scoring engine reads it. Every field here has a corresponding term in the scoring
function — see the warning in [doc 04](./04-ai-agent-design.md) about what happens when
one does not.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Generated on the device — see [ADR-0015](./adr/ADR-0015-client-ids-and-sync.md) |
| `user_id` | uuid, nullable | Null while the account is a guest |
| `name` | text | *"Sabah koşusu"* — user-facing, not the activity slug |
| `activity` | text | `running`, `cycling`, `picnic`, … Drives defaults, not scoring |
| `temp_min` / `temp_max` | int, °C | Canonical units always |
| `wind_max_kmh` | int | |
| `precip_max_pct` | int | Probability, not millimetres — it is what people reason in |
| `uv_max` | int, nullable | Null means the user did not care |
| `preferred_hours` | int[2], local time | `[6, 10]`. The field whose absence from the formula once made 03:00 the best hour of the week |
| `created_at` / `updated_at` | timestamptz, UTC | |

**Scoring weights are not stored here.** How many points a degree over the limit costs is
an engine constant, identical for everyone. A per-profile weight would be a tuning knob no
user can reasonably set, and it would make two people's scores incomparable.

**Hard exclusions are also engine constants.** A thunderstorm or freezing rain removes an
hour outright regardless of profile. That is not a preference.

### SavedLocation

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid, nullable | |
| `label` | text | What the user calls it, not what the geocoder returned |
| `latitude` / `longitude` | numeric(8,5) | Five decimals, ~1 m |
| `timezone` | text | IANA name, e.g. `Europe/Istanbul` |
| `is_current` | bool | The device's own position, at most one |
| `sort_order` | int | |

Cache keys round coordinates to **two decimals (~1 km)**, so neighbours share an entry.
The stored value keeps full precision; only the key is rounded.

### ForecastHour

Normalised from Open-Meteo, never synced — it is derived data and always re-fetchable.

> **Server only, as of [ADR-0016](./adr/ADR-0016-cache-the-scored-plan.md) (2026-09-05).**
> This table was originally specified as living "identically on both sides". It does not
> exist on the device, and cannot usefully: the trace draws a comfort score per hour, and
> turning a `ForecastHour` into one is the scoring engine, which [ADR-0007](./adr/ADR-0007-deterministic-scoring-engine.md)
> and doc 02 both keep off the client. A device copy would either be unusable or come with
> a second implementation of the engine. The device caches the **scored `/plan` response**
> instead.

| Field | Type | Notes |
|---|---|---|
| `location_key` | text | Rounded `lat,lon` |
| `hour_utc` | timestamptz | Always UTC |
| `local_hour` | int | 0–23 in the location's timezone, denormalised because every query needs it |
| `temperature_c` | real | |
| `precip_prob_pct` | int | |
| `precip_mm` | real | |
| `wind_kmh` | real | |
| `uv_index` | real | |
| `cloud_cover_pct` | int | |
| `weather_code` | int | WMO code — the source of truth for the atmosphere state |
| `fetched_at` | timestamptz | Staleness is computed from this at render time |

**`weather_code` matters more than it looks.** The thirteen atmosphere states in
[doc 10](./10-design-language.md) were demonstrated using precipitation and cloud cover,
which cannot tell snow from rain or hail from a shower. WMO codes can:

| Code | State |
|---|---|
| 0 | Clear (day or night by sun elevation) |
| 1–2 | Partly cloudy |
| 3 | Overcast |
| 45, 48 | Fog |
| 51–57, 61–63, 80–81 | Light rain |
| 65, 66, 67, 82 | Downpour |
| 71–77, 85, 86 | Snow |
| 95 | Thunderstorm |
| 96, 99 | Hail |

Extreme heat, extreme cold and windy are **not** WMO conditions — they are thresholds on
temperature and wind, applied over whatever the code says. They modify the scene rather
than replacing it.

### NotificationRule

`profile_id`, `kind` (`rain` | `window`), `lead_time_minutes`, `quiet_hours`, `enabled`.
Evaluated server-side; the device only registers a push token.

### AskExchange

Device only. `question`, `response_json`, `tool_calls`, `duration_ms`, `created_at`.
Capped at twenty rows, oldest evicted. Never uploaded, never migrated to an account —
consistent with [doc 11](./11-screen-flows.md).

## Rules that apply everywhere

**Canonical units in storage, always.** Celsius, km/h, millimetres, UTC. Conversion
happens at render. A `temperature_f` column would eventually hold Celsius somewhere.

**Timestamps are UTC; forecast hours also carry local context.** A weather application
lives and dies on timezone handling, and a naive local timestamp is a bug waiting for a
DST boundary. `hour_utc` is authoritative, `local_hour` is a denormalised convenience, and
`SavedLocation.timezone` is the IANA name the two are reconciled through — never a fixed
offset, which would break twice a year.

**Deletion is real deletion.** Account deletion cascades to profiles, locations, rules and
tokens. No soft-delete flag, no tombstones. A privacy claim the code does not honour is
worse than no claim.

## The shared contract

`packages/schema` holds the JSON Schema definitions for everything that crosses the wire,
generated into Pydantic on the server and Zod on the client. This is the same schema handed
to the model for constrained decoding, so **the API contract and the model's output
contract cannot drift apart** — one definition, three consumers.

Not everything is shared. `RefreshToken` is server-only, `AskExchange` is device-only, and
neither belongs in the contract.

## Sync

Full reasoning in [ADR-0015](./adr/ADR-0015-client-ids-and-sync.md).

- **Ids are UUIDv7, generated on the device.** A guest can create a profile with no network
  and no server round-trip, and signing up later does not renumber anything.
- **The server is authoritative once an account exists.** The device holds a copy and
  queues its edits.
- **Conflicts resolve last-write-wins per record**, on `updated_at`.

That last rule has a cost, stated plainly: two devices editing the same profile while both
offline means one edit disappears, silently. Field-level merge or CRDTs would prevent it
and would cost more than the problem is worth for a household-scale app editing a handful
of records. If that assumption turns out wrong, this is the decision to revisit.

**Guest to account** uploads profiles and locations, keyed by their existing ids. Because
ids were generated on the device, the upload is an insert, not a remap. Same-named
profiles are offered as a merge rather than silently overwritten.

## Migrations

| Side | Tool | Rule |
|---|---|---|
| Server | Alembic | Every schema change is a reviewed migration. No `create_all()` |
| Device | Drizzle | Forward-only, run at launch before the first query |

Device migrations are the harder half: an installed app holds a database written by an
older version, and a failed migration on a phone is not a migration you can go and fix.
Every device migration must be **idempotent** and must not destroy user-owned data. When a
migration cannot be made safe, the cache is dropped and re-fetched — a cache is always
disposable, and profiles never are.

## What exists so far

`users`, `refresh_tokens`, `saved_profiles` and `saved_locations`, created by Alembic
(2026-09-03). `NotificationRule` is still specified rather than built. The client still
sends constants, because nothing on the device reads these endpoints yet.

**The stored profile is split in two, and the split is deliberate.** `ActivityProfile` in
`packages/schema` is what the scoring engine reads, and it is sent inline with every
`/plan` and `/ask` request. `SavedProfile` wraps it with the things only a *stored* profile
has: an id, a name a person chose, and the timestamps conflicts are resolved on. The
constraints are referenced rather than repeated, so there is still one definition of what
the engine reads — copying those seven fields into a second schema is the drift the
package exists to prevent.

**`user_id` is `NOT NULL` here, where the table above says nullable.** That row describes
the *device's* schema, where a profile has no owner until an account exists. On the server
a guest has no rows at all, so a nullable owner would create a second kind of row that
nothing owns and no query filters by — the confusion guest mode is designed to avoid.
This document's own opening sentence is the licence: the two stores are not the same
schema, and pretending otherwise is how sync bugs start.

### Invariants the database holds

Three rules live in Postgres rather than in a handler, because a handler is something a
future writer has to remember:

- `temp_min <= temp_max`, the one cross-field rule JSON Schema cannot express.
- `preferred_hours` has exactly two elements.
- At most one current location per account, as a partial unique index — many rows with
  `is_current = false`, at most one with `true`. A plain unique constraint on `user_id`
  would have allowed only one saved place in total.

Each is tested by writing a row that violates it directly, bypassing the API. A constraint
nothing has ever violated is a comment with a `CREATE` statement attached.

### Writes, and what a conflict looks like

`PUT` rather than `POST`, because the client names the resource (ADR-0015). That makes a
retry after a dropped response harmless instead of a duplicate.

The last-write-wins rule is compared strictly: a write whose `updated_at` is *equal* to
the stored value is treated as stale, because it is a resend of what the server already
holds. A losing write is answered `409` **with the record that won**, not a bare error —
the ADR accepts that an edit can disappear, but a client that is never told which version
survived will resend an edit that can never land.

One defect surfaced while testing ownership. Lookups are scoped by owner and the primary
key is global, so an account writing to an id belonging to somebody else found nothing of
its own, tried to insert, and collided — surfacing a 500 from inside the driver, which is
both an unhelpful answer and a usable signal that the id exists. It is a `409` now.

Tests run against a real Postgres rather than SQLite, in CI as well as locally. `uuid`,
`timestamptz` and `ON DELETE CASCADE` all behave differently or not at all on SQLite, and
a suite that passes against an engine the service never uses proves less than it looks
like it does. The cascade in particular is asserted rather than assumed — "deletion is
real deletion" is a claim above, and an untested cascade is how such a claim quietly
becomes false.

The suite builds its schema from the models with `create_all`, which cannot notice a
migration that disagrees with them. CI runs `alembic upgrade head` and `alembic check`
against an empty database for exactly that gap.

## The device side

Built 2026-09-03, with Drizzle over `expo-sqlite`. Two tables so far: `saved_profiles`
and `ask_exchanges`.

**This is what makes guest mode real.** Before it, a guest got three constants they could
not change, and "everything works without an account" was only true of the parts that
needed no storage. A guest's profiles now persist, and are edited through exactly the
same screen an account's are — one interface over two stores, so the two paths cannot
drift into behaving differently.

The schemas genuinely differ, as this document insists they should. `user_id` really is
nullable here, because a guest's rows are the normal case; on the server they cannot
exist. Timestamps are text, because they cross the wire as RFC 3339 and are compared as
strings for last-write-wins — storing epoch integers would mean converting twice on every
read and write to gain nothing, and ISO-8601 in UTC already sorts lexicographically.
SQLite has no array type, so `preferred_hours` is two columns.

`saved_profiles` carries a `pending` flag: the edit queue ADR-0015 describes, in one
column. A guest's rows are all pending by definition — there is nowhere to send them —
and become the upload payload the moment an account exists.

`ask_exchanges` never leaves the device, even when an account does exist. What someone
asks an assistant is more revealing than which profiles they keep. Capped at twenty,
oldest evicted, in one statement rather than a count followed by a delete — the gap
between two statements is where a concurrent insert makes the cap wrong.

### The plan cache

Built 2026-09-05, and it is what lets the app open with no server.

What is cached is the **scored `/plan` response**, not raw forecast hours — the reasoning
is [ADR-0016](./adr/ADR-0016-cache-the-scored-plan.md), and the short version is that the
client cannot score without a second copy of the engine.

Keyed by rounded location *and* by the profile's limits, because the same forecast scores
differently for a runner and for a picnic. The location half rounds to two decimals, about
a kilometre, the same way the server rounds for its own cache — so the two agree on what
counts as the same place and a few metres of GPS drift does not miss the entry. The limits
half lists fields in a fixed order rather than iterating the object, which would make the
key depend on how the object happened to be built.

It is handed to React Query as `initialData`, not `placeholderData`. This is real data the
device has, and a placeholder is discarded on error — which is the one moment it is worth
the most. `initialDataUpdatedAt` carries the response's own `fetched_at`, so an entry
older than the ten-minute stale time refetches immediately rather than being trusted
because it exists.

When the server cannot be reached and there is an entry, İz draws it and says so, with the
age on it. Not styled as an error: nothing is broken, and this is the thing the cache was
kept for — the same distinction doc 10 draws for the assistant being unreachable, which is
reduced capability rather than failure.

Twelve entries, newest kept, pruned in one statement. At the measured 39 KB per response
that is a ceiling of about 456 KB.

### Guest to account

Built 2026-09-03. ADR-0009 calls this the fiddliest part of the feature and the one most
likely to harbour bugs, which turned out to be fair.

**It is offered, never automatic.** "Nothing is stored unless you ask us to" is the
sentence that justifies guest mode existing, and uploading someone's profiles the instant
they sign in is that sentence being quietly dropped. Declining is a real answer, so the
offer waits in Sen rather than being a prompt that disappears.

**The upload is an insert, not a remap**, because ids were generated on the device
(ADR-0015). A profile keeps the identity it already had, there is no mapping table, and
the id on the phone is the id on the server.

**A row is claimed because it is on the server, not because a request returned a
particular status.** Every pending profile is `PUT`, and then the account's list is
fetched once and every id that appears is claimed locally.

That indirection came out of measurement, not caution. Re-running an upload that already
succeeded returns **409**: the record carries the same `updated_at` the server holds, and
last-write-wins treats an equal timestamp as stale. The first version read that as failure
and left the row pending forever — the offer would never clear, and pressing it would do
nothing, repeatedly. The same misreading breaks when the app is killed between a
successful `PUT` and the local claim. Asking the server what it holds is correct for both,
costs fewer requests than asking per row, and distinguishes the *other* 409 — an id
belonging to a different account — for free, since that id does not appear in this
account's list.

Three cases were run against the running service: killed between upload and claim (3
moved, 0 failed), a complete re-run where every write returns 409 (3 moved, 0 failed), and
an id already owned by another account (1 moved, 1 failed, and the other account
untouched).

**Merging by name is deliberately not done.** Two profiles called "Koşu" — one on the
device, one already in the account — stay two profiles: they have different ids and
different limits, and collapsing them would lose whichever the code happened to pick. This
document asks for a merge to be *offered*; that needs a screen which does not exist yet,
and duplicates a person can see and delete are a far smaller problem than an edit that
vanished.

**Claimed rows do not come back on sign-out.** They belong to the account now, and
resurrecting them for whoever next uses the phone would be the wrong answer to a question
about someone else's data.

### Migrations, and the two halves of getting them into the bundle

`drizzle-kit generate` emits SQL plus a `migrations.js` that imports it, and both have to
end up inside the app: a phone has no filesystem to read `.sql` from at launch. Two
pieces of configuration are needed and **each one alone fails in a way that looks like the
other is missing**:

- `sourceExts.push("sql")` in `metro.config.js`, or the resolver reports "None of these
  files exist" about a file that plainly does.
- `babel-plugin-inline-import` for `.sql`, or the resolver finds the file and hands it to
  the JavaScript parser, which fails on `CREATE TABLE`.

Neither was discovered by reading; the bundle simply refused to build. The project had no
Metro or Babel config before this, which was correct — `babel-preset-expo` is what
configures the worklets plugin Reanimated needs, so the new Babel config keeps the preset
and adds one plugin.

A failed migration is the one storage error the app stops for. docs' rule is that a
device migration must never destroy user-owned data, which means there is nothing safe to
do automatically when one fails: the obvious repair — drop and rebuild — is exactly what
would throw away the profiles the rule protects. The app says so and stops.

`npm run check-migrations` applies every migration to an empty database using Node's own
SQLite, so CI covers this half without a device or a simulator. Verified by breaking a
migration on purpose. What it cannot check is a migration against a database written by
an older version of the app; that needs a fixture per released schema, and there has been
one.

## Still open

- **Retention on the server's `ForecastHour`.** Rows accumulate; nothing prunes them yet,
  and the server needs to decide whether it keeps history at all. The device's own cache
  has a ceiling of twelve entries — a guess, as ADR-0016 says, not a finding.
- **Historical comparison.** *"6° warmer than yesterday"* needs past observations, which is
  a different Open-Meteo endpoint and a different table.
- **Push token storage.** Device registration exists in the model above but the token
  lifecycle — rotation, invalidation, multiple devices — is unspecified.
