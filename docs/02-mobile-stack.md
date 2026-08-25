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
| Animation | Reanimated 3 + Gesture Handler | Runs on the UI thread; required for the timeline scrubber to stay smooth |
| Drawing | Skia | Gradient sky, particle precipitation, custom charts |
| Styling | Unistyles | Theme and dark mode handled centrally, no runtime class parsing |
| Secure storage | `expo-secure-store` | Refresh token belongs in Keychain / Keystore, not in AsyncStorage |
| Builds | EAS Build | Produces a downloadable artifact from CI without a local toolchain |

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

- The timeline scrubber runs on the UI thread. No `setState` per frame.
- Weather particle effects are drawn in Skia, not composed from views.
- Lists are virtualised. The hourly view can hold 168 entries (seven days) without
  degrading.

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
