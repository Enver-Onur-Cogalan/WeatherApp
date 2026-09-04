/**
 * What colour the sky is, and what ink stays readable on it.
 *
 * The gradient maths used to live inside `atmosphere.tsx`, which was fine while the canvas
 * was the only thing that needed it. It is here now because a second consumer appeared and
 * the two must not drift: text that adapts to a sky computed slightly differently from the
 * sky actually drawn is worse than text that does not adapt at all.
 *
 * ## Why the ink moves
 *
 * Measured, at 14:00 with a clear sky, against the WCAG contrast ratio:
 *
 * | depth | sky              | #EDE7DB | #0B1020 |
 * |-------|------------------|---------|---------|
 * | 5%    | rgb(45,97,153)   | 5.20    | 2.96    |
 * | 25%   | rgb(78,126,174)  | 3.47    | 4.44    |
 * | 45%   | rgb(111,155,194) | 2.39    | 6.44    |
 *
 * Bone white on a midday sky reaches 2.05 at its worst — below the 3.0 that even large
 * text is meant to clear, and the reason some labels were simply not visible. Dark ink on
 * the same background reaches 7.51.
 *
 * This is not a light theme arriving through the back door. docs/10 says daylight arrives
 * through the atmosphere layer rather than through a theme, and the instrument the design
 * is named for is a *card* — light stock with a dark burn on it. Ink that follows the
 * light is that idea finished, not reversed.
 *
 * ## What it cannot fix
 *
 * There is a band around luminance 0.15–0.20 where neither ink clears 4.5; the best either
 * manages is about 4.2. No choice of two colours fixes it, because the background sits
 * halfway between them. It is a narrow strip, it clears the 3.0 bar for large text, and it
 * is a long way better than 2.05 — but it is not AA for body text and saying otherwise
 * would be a lie.
 */

import { colors } from "@/theme";

export type Rgb = [number, number, number];

/** Kept as tuples to the last moment: a mid-conversion css string once produced `NaN`. */
const NIGHT_TOP: Rgb = [7, 10, 24];
const NIGHT_LOW: Rgb = [30, 41, 74];
const DAY_TOP: Rgb = [38, 92, 152];
const DAY_LOW: Rgb = [124, 168, 204];
const OVERCAST_TOP: Rgb = [40, 46, 62];
const OVERCAST_LOW: Rgb = [78, 86, 100];
const BURN: Rgb = [196, 104, 44];
const GROUND: Rgb = [16, 22, 42];

/** The fraction of the screen the sky occupies before it becomes the app's own ground. */
export const FADE_AT = 0.62;

/** Where the gradient reaches its lower colour, before turning to ground. */
const LOW_AT = 0.82;

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export const css = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Zero at 06:30 and 19:30, peak at 13:00 — enough to move a gradient honestly. */
export const elevation = (hour: number) =>
  Math.max(0, Math.sin(((hour - 6.5) / 13) * Math.PI));

export function skyStops(localHour: number, cloudCoverPct: number): { top: Rgb; low: Rgb } {
  const sun = elevation(localHour);
  const overcast = cloudCoverPct / 100;

  let top = mix(NIGHT_TOP, DAY_TOP, sun);
  let low = mix(NIGHT_LOW, DAY_LOW, sun);
  top = mix(top, OVERCAST_TOP, overcast * 0.7);
  low = mix(low, OVERCAST_LOW, overcast * 0.6);

  // A low sun brings the burn into the horizon band — where the palette came from.
  if (sun > 0 && sun < 0.34) {
    low = mix(low, BURN, ((0.34 - sun) / 0.34) * 0.45 * (1 - overcast * 0.5));
  }
  return { top, low };
}

/**
 * The colour behind a point, as a fraction of screen height.
 *
 * Mirrors the gradient the canvas draws: `top` at 0, `low` at 82% of the fade, and the
 * app's ground by the end of it. Below that the sky is gone and the answer is the ground.
 */
export function skyAt(localHour: number, cloudCoverPct: number, fraction: number): Rgb {
  if (fraction >= FADE_AT) return GROUND;

  const { top, low } = skyStops(localHour, cloudCoverPct);
  const t = fraction / FADE_AT;
  return t <= LOW_AT ? mix(top, low, t / LOW_AT) : mix(low, GROUND, (t - LOW_AT) / (1 - LOW_AT));
}

/** Relative luminance, per WCAG. */
export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export type Ink = {
  ink: string;
  ink2: string;
  inkDim: string;
  accent: string;
  rule: string;
};

const NIGHT_INK: Ink = {
  ink: colors.ink,
  ink2: colors.ink2,
  inkDim: colors.inkDim,
  accent: colors.burnHi,
  rule: colors.rule,
};

/**
 * The day set.
 *
 * Every colour is the night palette's counterpart pulled to the other end of the same
 * family rather than a new hue: the primary is the night sky's own top, and the accent is
 * the scorch at the depth it has before it is lit. The app should look like the same
 * instrument in daylight, not like a second design.
 */
const DAY_INK: Ink = {
  ink: "#0B1020",
  ink2: "#1C2440",
  inkDim: "#2A3355",
  accent: "#6B3410",
  rule: "rgba(11,16,32,0.28)",
};

/**
 * Where the two inks cross.
 *
 * 0.175 is measured, not chosen: it is the luminance at which white and dark reach the
 * same ratio (about 4.3). Switching anywhere else means spending time on the wrong side
 * of the better option.
 */
const CROSSOVER = 0.175;

export function inkOn(background: Rgb): Ink {
  return luminance(background) > CROSSOVER ? DAY_INK : NIGHT_INK;
}

export { DAY_INK, NIGHT_INK };
