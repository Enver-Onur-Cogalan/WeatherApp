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

ForecastHour        cache, both sides, never synced
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

Normalised from Open-Meteo, stored identically on both sides, never synced — it is
derived data and always re-fetchable.

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

`users` and `refresh_tokens`, created by Alembic (2026-09-03). `ActivityProfile`,
`SavedLocation` and `NotificationRule` are still specified rather than built, so the
profiles the app sends are constants in the client.

Tests run against a real Postgres rather than SQLite, in CI as well as locally. `uuid`,
`timestamptz` and `ON DELETE CASCADE` all behave differently or not at all on SQLite, and
a suite that passes against an engine the service never uses proves less than it looks
like it does. The cascade in particular is asserted rather than assumed — "deletion is
real deletion" is a claim above, and an untested cascade is how such a claim quietly
becomes false.

The suite builds its schema from the models with `create_all`, which cannot notice a
migration that disagrees with them. CI runs `alembic upgrade head` and `alembic check`
against an empty database for exactly that gap.

## Still open

- **Retention on `ForecastHour`.** Rows accumulate; nothing prunes them yet. The device
  needs a ceiling, and the server needs to decide whether it keeps history at all.
- **Historical comparison.** *"6° warmer than yesterday"* needs past observations, which is
  a different Open-Meteo endpoint and a different table.
- **Push token storage.** Device registration exists in the model above but the token
  lifecycle — rotation, invalidation, multiple devices — is unspecified.
