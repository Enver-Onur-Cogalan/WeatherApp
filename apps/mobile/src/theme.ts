/**
 * Design tokens for the instrument direction.
 *
 * The full reasoning is in docs/10-design-language.md; the short version is that the
 * palette comes from atmospheric optics rather than interface convention, and the app
 * commits to one visual world — an instrument reading a night sky. Daylight arrives
 * through the atmosphere layer, not through a light theme.
 *
 * Nothing outside this file should contain a colour literal.
 */

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
 * Two families, three roles. Archivo's width axis carries the hierarchy — expanded for
 * a verdict, normal for prose — so no second display face is needed. IBM Plex Mono holds
 * every number, which is functional rather than stylistic: scrubbing updates four values
 * per frame, and proportional digits would make the readout twitch.
 */
export const type = {
  display: {
    fontFamily: "Archivo_700Bold",
    fontVariationSettings: '"wdth" 125',
    letterSpacing: -0.4,
    textTransform: "uppercase" as const,
  },
  heading: {
    fontFamily: "Archivo_600SemiBold",
    fontVariationSettings: '"wdth" 118',
    textTransform: "uppercase" as const,
  },
  body: {
    fontFamily: "Archivo_400Regular",
    fontVariationSettings: '"wdth" 100',
  },
  data: {
    fontFamily: "IBMPlexMono_500Medium",
    fontVariant: ["tabular-nums" as const],
  },
  label: {
    fontFamily: "IBMPlexMono_500Medium",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
  },
} as const;

export const size = {
  verdict: 30,
  span: 26,
  title: 20,
  body: 15,
  caption: 13,
  label: 10,
} as const;
