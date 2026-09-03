# 02 — Mobile Stack

## Platform

React Native via **Expo**. The reasoning is in
[ADR-0001](./adr/ADR-0001-react-native-expo.md); in short, Expo's managed workflow with
config plugins gives us native capability (widgets, secure storage, camera) without
maintaining two native projects by hand.

## Library choices

| Concern | Choice | Why this one |
|---|---|---|
| Navigation | `expo-router` | File-based routing; deep links come for free, which matters for widget taps |
| Server state | TanStack Query | Caching, retry, and stale-while-revalidate are the offline strategy, already solved |
| Client state | Zustand | Small surface, no boilerplate, no provider tree |
| Persistence | `expo-sqlite` + Drizzle | Typed queries over a real database; the offline cache is not a key-value blob |
| Animation | Reanimated + Gesture Handler | Runs on the UI runtime; required for the timeline scrubber to stay smooth |
| Drawing | Skia | The comfort trace, and the atmosphere layer as SkSL runtime shaders |
| Styling | Unistyles | Theme and dark mode handled centrally, no runtime class parsing |
| Secure storage | `expo-secure-store` | Refresh token belongs in Keychain / Keystore, not in AsyncStorage |
| Builds | EAS Build | Produces a downloadable artifact from CI without a local toolchain |

## Custom versus native components

The design language is highly specific ([doc 10](./10-design-language.md)), and `@expo/ui`
offers real SwiftUI and Jetpack Compose components. These pull in opposite directions, so
the line is drawn once here:

| Surface | Built how | Why |
|---|---|---|
| İz, Sor | Custom, from our tokens | The trace, the burn, the verdict typography — this is where the design carries meaning, and a native control would flatten it |
| Sen, pickers, sheets, form controls | `@expo/ui` native components | A settings screen has no thesis. Platform convention serves the user better than our opinion does |
| Tab bar | Custom, compact | See the exception below — `NativeTabs` exposes no height, and Material 3's 80dp is a block of another design language under a hairline screen |

The rule: **custom where the design says something, native where it would only say
"we styled this ourselves".**

**The exception, and what it costs.** Native unless the platform default is materially
wrong for the design *and* the component offers no way to adjust it. The tab bar is the
one place that applies so far: `NativeTabs` exposes no height, Material 3's is 80dp, and
`labelVisibilityMode` trimmed it without being enough. It is custom now, at 46dp plus the
safe-area inset.

That is a cost, not a free win. The platform's ripple, its translucency and its own
accessibility handling all become ours to reproduce, and every one we forget is a
regression nobody will file. The custom bar carries explicit roles and selected states
for exactly that reason, and honours `preventDefault` on a tab press so a screen can
still intercept its own tab — scroll-to-top, or discarding a draft before leaving.

**Icons need both platforms named.** SF Symbols exist only on iOS, and setting only
`sf` shipped an Android tab bar with no icons at all. Every native icon slot takes an
`sf` name *and* a `VectorIcon` fallback.

## Offline strategy

The application is **offline-first by default**, not offline-tolerant as an afterthought.

```
render ──► read from SQLite immediately  (always succeeds, may be stale)
       └─► revalidate in background      (may fail silently)
       └─► update SQLite and re-render   (only if revalidation succeeded)
```

Consequences of this ordering:

- The first frame never waits on the network.
- Staleness is **visible**: every screen that shows forecast data also shows when that
  data was fetched. A number without a timestamp is a lie in a weather application.
- A failed refresh is not an error state. It is a stale state, which is different, and
  the UI treats it differently.

## Streaming responses

The agent streams its answer over Server-Sent Events. This is a known rough edge in
React Native: the standard `fetch` implementation does not expose a readable body
stream, so the usual web approach does not work.

We use `expo/fetch`, which is WinterCG-compliant and does expose streaming bodies.
This is written down because it is the kind of detail that costs an afternoon if you
discover it late.

## Performance commitments

These are commitments, not aspirations — they are the reason for several library
choices above.

- The timeline scrubber runs on the UI runtime. No `setState` per frame, and nothing
  scheduled back to the RN runtime inside `onUpdate` — that fires 60–120 times a second.
  Threshold work belongs in `onEnd` or a `useAnimatedReaction`.
- The sky and precipitation are Skia runtime shaders (SkSL) with uniforms driven by
  Reanimated shared values, not particle views. Scrubbing never crosses the bridge.
- Lists are virtualised. The hourly view can hold 168 entries (seven days) without
  degrading.

## Visual direction

The design language is [doc 10](./10-design-language.md); the direction was chosen in
[ADR-0012](./adr/ADR-0012-instrument-visual-direction.md) and the atmosphere layer's terms
are set in [ADR-0013](./adr/ADR-0013-data-driven-atmosphere.md).

One consequence belongs here rather than there: the atmosphere layer has a real GPU and
battery cost, and its quality tier is **not yet designed**. Before this screen is built we
need a measured figure for a mid-range Android, and an order in which things get dropped.

## Accessibility and internationalisation

- Every interactive element carries an accessibility label; the timeline scrubber
  exposes an accessible value so it is usable without sight of the gradient.
- Dynamic type is respected. Layouts are tested at the largest system font size.
- Turkish and English from the first release. Units (°C/°F, km/h, mph) follow the
  locale but are overridable — a Turkish user living abroad is a real case.

## What is not in the mobile layer

No business logic. The client does not decide what a "good window for a bike ride" is;
it renders what the service decided. This keeps the rules in one place, where they are
tested, rather than duplicated in TypeScript where they would quietly diverge.

## Talking to the service

Wired up 2026-09-03, replacing the recorded fixtures both screens were built against.

`/plan` is a query and `/ask` is a mutation, and the difference is not bookkeeping. The
plan is a read of the same forecast the server already has cached, so it is retried,
cached for ten minutes, and holds its previous result while a new activity is scored —
switching a chip should feel like a filter, not a page load. The assistant is an event
with a measured median of 27 seconds of local inference (docs/08), so it is **never**
retried automatically: a silent second attempt turns a failed 47-second wait into a
failed 94-second one, having asked the user's own machine to do the same expensive work
twice. Nor is a 4xx or a schema mismatch, which are bugs on the client's side and will
not improve on the second try.

The timeouts come from the same measurement rather than from habit. A conventional
30-second default would abort answers that were about to arrive; `/ask` is allowed 90
seconds and `/plan`, which is arithmetic over a cached forecast, is allowed 15.

**Responses are parsed, not cast.** Every response goes through the Zod schema generated
from `packages/schema`, so a server that changes shape fails at the boundary with a
description of what changed, rather than as `undefined` somewhere inside a worklet. This
mattered immediately: until this was wired up the app declared its own hand-written copy
of every response type, which is precisely the drift `packages/schema` exists to prevent,
reintroduced one directory away. Two of those copies were already wrong — the assistant's
`best_window` carries no `length_hours`, though the ranked windows in a plan do, and the
app was typed to read a field the API never sends.

### Running it against a local backend

`npm run api` from the repository root, or `docker compose up`. The address is derived
from Metro — the dev server reports the host the phone actually connected on, so a phone
on the LAN gets the Mac's LAN address and nothing needs configuring. `EXPO_PUBLIC_API_URL`
overrides it.

Two failures look identical from the phone and neither is the app's fault, which is why
there is a script rather than a command in a README:

- **uvicorn binds `127.0.0.1` by default.** That is the Mac's own loopback, so the
  service is invisible from the phone while being perfectly healthy from `curl` on the
  Mac. Everything about the phone looks correct — same Wi-Fi, right address, no answer.
- **`JWT_SECRET` is required and has a minimum length.** Without it the service exits
  during startup with a Pydantic validation error raised inside a lifespan handler, which
  is a long way from "set this variable".

Both cost a round trip of questions on the first device session, with the screen saying
*sunucuya ulaşılamıyor* and being entirely right. The failure card now prints the address
it tried, because the interface knew and did not say.

### Error states, and why they arrive with the network

The app had no failure path anywhere in the interface, for the simple reason that a
fixture always answers. Connecting to a real service creates real failures, so F4 in
docs/13 was not optional work that could be scheduled afterwards — it is part of the same
change.

Failures are named rather than counted: an unreachable server, a slow one, a forecast
that could not be retrieved, a request the server rejected, and a contract that has
drifted are five different sentences, and docs/10 requires each to explain what happened
and offer a fix. The retry button appears only when pressing it could plausibly work;
offering it on a schema mismatch would be a lie.

## Profiles, and what an account changes

Wired up 2026-09-03. İz's chips are saved profiles when there are any, and the built-in
three otherwise — including for a signed-in account that has not saved anything.

**İz always has something to draw.** A signed-in account with no profiles falls back to
the same defaults a guest uses rather than showing an empty state that must be cleared
before the app works. Saving a profile is additive, never a prerequisite. Nothing is
written to an account without being asked for either: seeding the three defaults on first
sign-in would be convenient and would also be data the person never created, in an
account whose whole premise is that it stores what they ask it to. Sen offers a button
instead.

Ids are UUIDv7, generated on the device (ADR-0015). `expo-crypto` only offers v4, so v7
is written out — the timestamp in the high bits is the point: ids sort by creation, an
index on the primary key stays dense, and a list needs no second column to order by. The
implementation is checked against RFC 9562 rather than trusted, including the trap that
`Date.now()` exceeds 32 bits and `>>>` would truncate it, giving every id the same prefix.

The plan query is keyed on the *constraints* rather than on a profile's name or id: two
profiles with the same limits score identically, and renaming one should not refetch.

Limits are edited with steppers, not sliders. These are integers with meaning — 15 km/h
is a decision, and a slider that lands on 14 because of where a thumb stopped makes a
person fight the control instead of expressing a limit.

## Still open

- **Only profiles move.** Saved locations exist on the server and are not stored on the
  device at all, so the handoff has nothing to carry for them yet (docs/12).
- **One hard-coded location.** `Konumlar` is listed under Sen in docs/11 and unbuilt, so
  the app asks about İstanbul and now at least *says* so on both screens — the smaller
  half of F3. The larger half needs somewhere to store a place.
- **The profile the app sends is a default, not a preference.** Three activity profiles
  are constants in `lib/plan.ts` until the Sen screen can store what a person wants.
- **Nothing is persisted.** History does not survive a launch, and neither does the
  query cache; TanStack Query's persister and the Drizzle layer in docs/12 are both
  unbuilt.
- **No tests on the mobile side at all.** Types, lint and the shader check are the whole
  safety net, and none of them would notice a screen rendering the wrong thing.
