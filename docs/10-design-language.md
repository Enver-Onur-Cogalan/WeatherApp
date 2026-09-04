# 10 — Design Language

**Direction: Instrument.**
Live specimen: <https://claude.ai/code/artifact/deed917a-352d-46bf-9603-de34835c700a>

The decision itself, with the directions we rejected, is in
[ADR-0012](./adr/ADR-0012-instrument-visual-direction.md).

## The reframe

Every weather application opens with a temperature. This one answers a different
question, so it opens with a **span of time**.

The scoring engine does not produce a scalar. It produces an interval — *Saturday,
06:00–11:00* — along with the reason every hour lost points. A design led by a large
"24°" would be describing a product we did not build.

So temperature does not disappear; it moves. The trace is the **conclusion**, and the
readout beneath it is the **evidence**, one glance away. That ordering is the
architecture from [doc 01](./01-architecture-overview.md), drawn.

## Where the visual language comes from

Meteorology's own time-recording instruments, not interface convention.

- **The barograph** draws one continuous line across a rotating drum. That is our data
  shape exactly: a scalar over time.
- **The Campbell–Stokes recorder** focuses sunlight through a glass sphere and *scorches*
  the sunny hours into a card. Good windows are burned into the trace the same way.

We take the instrument's **logic** — precise traces, hairline grids, plotted marks,
tabular figures — and leave its **texture** behind. Sepia, paper grain and brass would be
a costume, and would fight the engineering signal the project exists to send.

## Palette

Derived from atmospheric optics. No sky-blue gradient, no glass, no neon accent.

| Token | Hex | Role |
|---|---|---|
| `ground` | `#10162A` | The sky forty minutes after sunset. Deliberately not black — black is an absence, this is a colour. |
| `ground-2` | `#161D33` | Raised surface |
| `surface` | `#1C2440` | Cards, inputs |
| `rule` / `rule-soft` | `#2A3355` / `#202741` | Hairlines, grid |
| `ink` | `#EDE7DB` | Bone white — the recording pen, and all primary type |
| `ink-2` | `#B4B7C6` | Running text |
| `ink-dim` | `#7E8399` | Secondary type, axis labels |
| `burn` | `#C4682C` | The scorch mark |
| `burn-hi` | `#E9A063` | Burn highlight, times, active state |
| `ember` | `#B0524A` | Hard violations and warnings |
| `glacial` | `#79A6B6` | Wind and cold data |

Three notes on why these and not others:

- **The burn is brown-orange, never golden.** A golden yellow reads as a warning badge.
  We want a mark left by heat.
- **`ember` is semantic and held apart from the accent**, so severity never competes with
  emphasis. A warning must not look like a highlight.
- **`ink-dim` is grey pulled toward the ground's indigo**, not a neutral off the shelf. A
  pure mid-grey reads as unconsidered.

The app is dark-first by commitment, not by toggle: it is an instrument reading a night
sky, and the atmosphere layer supplies daylight where daylight belongs.

## Typography

Two families, three roles.

| Role | Face | Setting |
|---|---|---|
| Verdict / display | **Archivo**, width 125 | Uppercase, tight tracking, heavy |
| Body / agent prose | **Archivo**, width 100 | Regular, 1.5–1.6 line height |
| All data | **IBM Plex Mono** | Tabular figures |

**The width axis is the hierarchy.** One variable family flexes from instrument-panel
wide in a verdict to quiet and normal in running text. No second display face is needed,
and the bundle stays small.

**What actually shipped, and why it differs.** `@expo-google-fonts` distributes static
instances rather than the variable font, and React Native cannot drive a `wdth` axis
reliably across both platforms. The wide register is therefore **Archivo Black** with
positive tracking — the same superfamily and the same intent, reached with a second file
instead of an axis. The variable font could be bundled directly later; it was not worth
the loading complexity to recover a difference this small.

**Monospace is functional, not stylistic.** Dragging the scrubber updates four values per
frame; proportional digits would make the readout twitch continuously. Every figure in
the interface carries `tabular-nums`.

Both faces carry full Latin Extended, so Turkish diacritics (ğ, ı, İ, ş, ç, ö, ü) render
correctly at every weight and width.

## Current conditions

The screen leads with a planning verdict, and the first build let that crowd out the
most common reason anyone opens a weather app. Temperature was present only as evidence
under the trace, reachable by scrubbing — which is to say, reachable by a gesture a
first-time user has no reason to try.

Current conditions now sit in a single line above the verdict: temperature, condition,
and the day's high and low. It answers the ordinary question at a glance without taking
the top of the screen from the argument the product is making.

The same correction runs through the week grid, which carries each day's high, low and
condition beside its windows — so one grid answers both *when should I go* and *is it
raining on Thursday*.

There is no separate weather tab. A fourth tab would demote the planner to a side
feature and show the same data twice; the reasoning is the same as
[ADR-0014](./adr/ADR-0014-planner-on-main-screen.md).

**Conditions are words, not pictograms.** The icon set is still undesigned, and a
placeholder glyph reads as a decision that was made. Words are honest until it is.

## The signature: the trace

A continuous line across the screen. What it plots is **not temperature** — it is the
composite comfort score for the active activity profile.

- Vertical position is the score at that hour.
- **Burn segments** mark open windows: contiguous hours above threshold, lasting at least
  two hours.
- Hairline gridlines every six hours, heavier at midnight.
- The scrubber is a vertical hairline with a dot on the trace.

Two properties make it the spine rather than a chart:

1. **It is the navigation.** Drag along it and every value on screen updates.
2. **It redraws per activity.** The same week is a different landscape for running than
   for cycling. That is the product's thesis, shown rather than stated.

## The atmosphere layer

Weather happens *to* the instrument, not behind it. Sky and precipitation occupy the far
and middle planes; the trace stays crisp in front and is never fogged.

Reasoning and consequences: [ADR-0013](./adr/ADR-0013-data-driven-atmosphere.md).

**Thirteen states**, each with its own physics rather than one effect recoloured:

| | | |
|---|---|---|
| Clear day | Clear night | Partly cloudy |
| Overcast | Light rain | Downpour |
| Thunderstorm | Snow | Hail |
| Fog | Windy | Extreme heat |
| Extreme cold | | |

Behaviour that differs by state, not just palette:

- Rain falls at the **wind's real angle** and splashes on impact.
- Hail is round, fast, and **rebounds**.
- Snow is slow and **sways sideways** — that oscillation is what separates it from rain.
- Storms carry a decaying **lightning flash** through the sky gradient.
- Extreme heat **bends the band above the horizon** with a sine offset.
- Extreme cold grows **frost crystals inward from the frame**.
- Fog is layered horizontal sheets moving at different rates, which is where its depth
  comes from.

**Clouds come in five kinds**, because a stratus sheet and a storm anvil are different
objects: `cumulus`, `stratus`, `nimbus` (dark, with the ragged underside rain falls out
of), `shear` (stretched flat by wind), and `veil`. Each is built from 9–12 overlapping
lobes on a **flat base** — the flat base is what seats a cloud in the sky instead of
leaving it floating — then shaded top-to-bottom across the whole silhouette and given a
lit crown.

**Nothing picks a state from a list.** The forecast does: precipitation sets density,
wind sets angle and drift, cloud cover sets deck type and opacity, and the sun's real
elevation moves the gradient.

The specimen selects the state from precipitation and cloud cover, which is enough to
demonstrate the idea and **not** enough to ship: those two cannot tell snow from rain, or
hail from a shower. Open-Meteo returns a WMO `weather_code` that can, and the mapping from
code to state is in [doc 12](./12-data-model.md). Extreme heat, extreme cold and windy stay
threshold-based, since they are not WMO conditions — they modify whatever the code says
rather than replacing it.

## Motion

Three moments. Everything else holds still.

| Trigger | What happens | Why it earns its place |
|---|---|---|
| On open | The trace draws left to right, burns igniting as the pen passes | One orchestrated sequence, and it is the instrument metaphor in a single gesture |
| On scrub | Four readings update continuously | Tabular figures mean the row never reflows, so the eye can hold one number |
| On activity switch | The trace morphs into a different landscape | The product's thesis, demonstrated |

`prefers-reduced-motion` removes all three **without removing information**: the trace
appears complete, the atmosphere renders a single frame, values still update on scrub.

## Copy

Words are design material. The rules we hold to:

- **Name things by what people control.** A person sets a *wind limit*, not a
  `wind_max_kmh` constraint.
- **A control says what happens.** The button that says *Kaydet* produces *Kaydedildi*.
- **Errors explain and offer a fix**, in the interface's voice. No apologies, no vagueness.
- **An empty screen is an invitation to act.** When no window clears the profile, we name
  the constraint that cost the most hours and offer to relax it — the scoring engine
  already knows, so withholding it would be waste.
- **Turkish and English are equals.** Neither is a translation layer over the other.

## States

| Situation | What the screen says |
|---|---|
| Assistant not running | *Asistan çalışmıyor. Tahminler ve pencereler çalışmaya devam ediyor.* — reduced capability, not an error |
| Data is stale | The trace desaturates and keeps its timestamp. A forecast without a time on it is a lie |
| No windows found | *Rüzgâr limiti 15 km/h — tek başına 112 saati eledi.* — plus the fix |
| Model returned nonsense | A templated answer built from the engine. Less fluent, still correct, and the user is not told anything went wrong |

## Ink follows the light

Added 2026-09-05, after a device session where labels were invisible around midday.

Measured before it was designed. At 14:00 the atmosphere's gradient runs to
`rgb(124,168,204)`, and the app's bone-white ink reaches a WCAG contrast of **2.05** on it
— below the 3.0 that even large text is meant to clear. Across the band from roughly 10%
to 58% of screen depth, *every* colour in the palette failed AA, primary text included.

So the ink moves. When the sky behind a block is light, that block uses a dark set drawn
from the same family — the primary is the night sky's own top colour, the accent is the
scorch at the depth it has before it is lit. The app should read as the same instrument in
daylight, not as a second design.

**This is not a light theme arriving by the back door.** The rule above is that daylight
arrives through the atmosphere layer rather than through a theme, and the instrument this
design is named for is a *card*: light stock with a dark burn on it. Ink that follows the
light is that idea finished rather than reversed. There is still no theme to choose and no
switch to set.

Each block asks about its own position rather than the screen taking one decision. The
gradient runs dark at the top, light in the middle and back to the app's ground, so at
midday the header and the trace legend want opposite inks at the same moment; one
screen-wide answer is wrong for one of them by construction. Scroll offset is part of the
question, because the sky is pinned to the screen while the content moves under it.

**What it cannot fix, stated plainly.** There is a band around luminance 0.15–0.20 where
neither ink clears 4.5 — the background sits halfway between them and the best either
manages is about 4.2. No two-colour scheme fixes that. It is a narrow strip, it clears the
3.0 bar for large text, and it is a long way from 2.05, but it is not AA for body text.

Measured after: the worst case anywhere in the day is now **4.21**, against 2.05 before,
and the point that was worst is now 6.44.

One colour deliberately does not move. Severe weather keeps its warning red at every hour
— a warning that changes shade with the time of day stops being one.

## Still open

- Screen-by-screen navigation graph and transitions (planned as `docs/11-screen-flows.md`).
- Icon set. The instrument direction suggests plotted marks over pictograms, but this has
  not been designed.
- Widget layout, which has to survive at a size where the trace may not fit.
