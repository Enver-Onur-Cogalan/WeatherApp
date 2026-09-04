/**
 * Design tokens for the instrument direction.
 *
 * The full reasoning is in docs/10-design-language.md; the short version is that the
 * palette comes from atmospheric optics rather than interface convention, and the app
 * commits to one visual world — an instrument reading a night sky. Daylight arrives
 * through the atmosphere layer, not through a light theme.
 *
 * Nothing outside this file should contain a colour literal, with one unavoidable
 * exception: `app.json`'s `backgroundColor` is the *native window* background, read before
 * any JavaScript runs, so it cannot be imported from here. It must stay equal to
 * `colors.ground` — when it was absent, the frame the keyboard uncovered was the
 * platform's default white for one frame (B2 in docs/13).
 */

import type { TextStyle } from "react-native";

export const colors = {
  /** The sky forty minutes after sunset. Deliberately not black. */
  ground: "#10162A",
  ground2: "#161D33",
  surface: "#1C2440",
  rule: "#2A3355",
  ruleSoft: "#202741",

  /** Bone white: the recording pen, and all primary type. */
  ink: "#EDE7DB",
  ink2: "#B4B7C6",
  /** Grey pulled toward the ground's indigo, not a neutral off the shelf. */
  inkDim: "#7E8399",

  /** The Campbell–Stokes scorch. Brown-orange on purpose — golden reads as a warning. */
  burn: "#C4682C",
  burnHi: "#E9A063",
  burnWash: "rgba(196, 104, 44, 0.16)",

  /** Semantic, held apart from the accent so severity never competes with emphasis. */
  ember: "#B0524A",
  glacial: "#79A6B6",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  pill: 999,
} as const;

/**
 * Three roles. The display register is wide and heavy, prose is normal, and IBM Plex
 * Mono holds every number — functional rather than stylistic, since scrubbing updates
 * four values per frame and proportional digits would make the readout twitch.
 *
 * Typed as `TextStyle` so spreading an entry into a `StyleSheet.create` block keeps its
 * shape; without it the whole sheet collapses to a style union and every consumer of a
 * plain `View` style stops type-checking.
 */
export const type: Record<
  "display" | "heading" | "body" | "data" | "label",
  TextStyle
> = {
  display: {
    // docs/10 specified Archivo flexed along its width axis. `@expo-google-fonts`
    // ships static instances only, and React Native cannot drive `wdth` reliably
    // across platforms — so the wide register comes from Archivo Black plus positive
    // tracking instead. Same superfamily, same intent, one file rather than an axis.
    fontFamily: "ArchivoBlack_400Regular",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  heading: {
    fontFamily: "Archivo_600SemiBold",
    textTransform: "uppercase",
  },
  body: {
    fontFamily: "Archivo_400Regular",
  },
  data: {
    fontFamily: "IBMPlexMono_500Medium",
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontFamily: "IBMPlexMono_500Medium",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
};

export const size = {
  verdict: 30,
  span: 26,
  title: 20,
  body: 15,
  caption: 13,
  label: 10,
} as const;
