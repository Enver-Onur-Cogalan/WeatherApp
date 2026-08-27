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
| Tab bar | `NativeTabs`, trimmed | Native, but `labelVisibilityMode: "selected"` — a full Material 3 bar is tall enough to fight a screen built around a hairline instrument |

The rule: **custom where the design says something, native where it would only say
"we styled this ourselves".**

Native does not mean untouched. Where the platform's default is loud enough to argue
with the design — the height of a Material 3 tab bar — it gets trimmed through the
options the component already offers, rather than replaced with our own.

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
