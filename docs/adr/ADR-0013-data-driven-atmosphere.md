# ADR-0013 — Atmosphere as a second reading, not decoration

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

[Doc 02](../02-mobile-stack.md) committed early to Skia for "gradient sky, particle
precipitation" — written before a visual direction existed. When
[ADR-0012](./ADR-0012-instrument-visual-direction.md) chose Instrument, the two appeared
to conflict: particle weather is the vocabulary of the atmospheric direction we had just
rejected, and visual noise behind a precision instrument makes the instrument harder to
read.

The proposal to cut it was raised and declined. Animated weather is a legitimate part of
what a weather app is, and it exercises the graphics work the mobile half of this project
exists to demonstrate.

So the question was not *whether*, but *on what terms*.

## Decision

Keep it, on one condition: **the atmosphere must carry data.**

- Precipitation **density** comes from precipitation probability.
- The **angle** every drop falls at comes from the actual wind speed.
- **Cloud deck type and opacity** come from cloud cover.
- The **sky gradient** comes from the sun's real elevation for that hour.
- Everything responds to the **scrubbed hour**, so dragging the trace changes the weather.

Nothing picks a state from a list. Thirteen states exist; the forecast selects among them.

Ground and figure stay separated: atmosphere occupies the far and middle planes, the
instrument stays crisp in front and is never fogged.

## Consequences

**Positive**

- The layer becomes a **second encoding of the same data** — wind and precipitation are
  readable without looking at a number. That is information design, which the instrument
  direction welcomes, rather than ornament, which it would reject.
- Scrubbing through a day and watching the weather change is the single most compelling
  thing the app does in a ten-second recording.
- Skia runtime shaders (SkSL) with uniforms driven by Reanimated shared values is a
  materially harder thing to have built than a particle view, and it is legible as such.

**Negative**

- **Cost.** Full-screen shaders every frame, on every device. This needs a quality tier —
  particle counts and plane count reduced on low-end hardware, and an option to disable
  the layer outright. Not yet designed; flagged here so it is not discovered late.
- Thirteen states is thirteen things to build, tune and keep looking right against every
  sky colour, day and night.
- Battery. An animated background on a screen people leave open is a real drain, so the
  layer must pause when the app is not foregrounded and when the device is in low-power
  mode.

**Neutral**

- `prefers-reduced-motion` renders one static frame. Information is unchanged; only the
  animation is removed.

## Alternatives considered

| Option | Why not |
|---|---|
| Cut it entirely | Cleanest against the direction, and the position originally proposed. Overruled: it discards a genuine capability and a real part of the genre. |
| Keep it purely decorative | The version that actually conflicts with the direction. Noise behind an instrument, with nothing earned. |
| Static illustration per condition | Cheap and safe, and gives up the thing that makes the layer worth having — responsiveness to real values. |

## Open question

The quality tier is undesigned. Before the mobile work starts we need a measured answer
to: what does this cost on a mid-range Android, and what gets dropped first?

**Still open after the first implementation (2026-08-27).** The layer is built — an SkSL
fragment shader for precipitation and a gradient driven by sun elevation and cloud cover
— and none of it has been profiled on a device. The knobs a tier would turn already
exist as uniforms (column count scales with intensity, and the shader returns early at
zero), so the tier is a decision waiting on a measurement rather than a rewrite. Until
that measurement exists, nothing in this project should describe the layer as cheap.
