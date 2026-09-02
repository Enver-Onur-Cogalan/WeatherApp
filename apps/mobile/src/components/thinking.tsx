/**
 * The wait, drawn as the instrument doing its work.
 *
 * A default spinner was wrong here for a measurable reason rather than a stylistic one:
 * the median answer takes 27 seconds on device (docs/08), and a system spinner that long
 * reads as a hang rather than as progress. It is also the only surface in the app that
 * looked like a generic React Native screen.
 *
 * So the wait borrows the app's own instrument. A Campbell–Stokes recorder burns a trace
 * into a printed card as its drum turns; the card is ruled before anything is written on
 * it, and the scorch is laid down by a moving point of focused light. That is exactly the
 * state being shown — the instrument is running and has nothing to report yet — and it is
 * the same vocabulary docs/10 took the palette from, so the wait belongs to the product
 * instead of interrupting it.
 *
 * Honest about what it does not know: the animation is indeterminate. The agent's two
 * phases are not streamed to the client, so a progress bar here would be fiction. The
 * elapsed seconds are real and appear once the wait stops being short.
 */

import { Canvas, Fill, Shader, useClock } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useDerivedValue, useReducedMotion } from "react-native-reanimated";

import { compileShader } from "@/lib/shader";
import { colors, size, space, type } from "@/theme";

/**
 * The card and the burn in one shader.
 *
 * One pass rather than a tree of nodes, because everything here is a function of x, y
 * and time — a baseline with its hour ruling, and a scorch whose head travels along it
 * leaving a tail that cools behind. The head wraps, and the tail is short enough that
 * the wrap is seamless: the drum is turning, so there is no moment where it restarts.
 */
const RECORDER = compileShader(
  "recorder",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_motion;    // 0 holds a still frame under reduced motion
uniform float3 u_burn;      // the scorch
uniform float3 u_burnHi;    // its hottest point, at the head
uniform float3 u_rule;      // the card's printed ruling

half4 main(float2 xy) {
    float w = u_resolution.x;
    float h = u_resolution.y;
    if (w <= 0.0) { return half4(0.0); }

    float base = h * 0.58;
    float fromBase = abs(xy.y - base);

    // The printed card, which exists before anything is burnt onto it.
    float baseline = smoothstep(1.1, 0.0, fromBase);
    float cell = w / 13.0;
    float within = fract(xy.x / cell) * cell;
    float toTick = min(within, cell - within);
    float ticks = smoothstep(0.9, 0.0, toTick) * smoothstep(h * 0.13, h * 0.10, fromBase);
    float card = max(baseline * 0.85, ticks * 0.55);

    // The burning point. Held still rather than stopped when motion is reduced, so the
    // state still reads as "working" without anything moving.
    float head = u_motion > 0.5 ? fract(u_time * 0.26) : 0.62;
    float x = xy.x / w;

    // Distance measured backwards from the head, wrapped, so the tail survives the seam.
    float behind = fract(head - x + 1.0);
    float along = smoothstep(0.34, 0.0, behind);

    // The groove widens where the light has dwelt longest — at the head.
    float thickness = h * (0.028 + 0.052 * along);
    float across = exp(-pow(fromBase / thickness, 2.0));
    float scorch = along * across;

    // The focused point itself: hotter, rounder, and brief.
    float toHead = min(behind, 1.0 - behind);
    float hot = exp(-pow(toHead / 0.030, 2.0)) * exp(-pow(fromBase / (h * 0.085), 2.0));

    float burnA = clamp(scorch * 0.8 + hot * 0.95, 0.0, 1.0);
    half3 burnRgb = mix(half3(u_burn), half3(u_burnHi), half(hot));

    // Premultiplied, burn over card.
    float outA = burnA + card * (1.0 - burnA);
    half3 pre = burnRgb * half(burnA) + half3(u_rule) * half(card * (1.0 - burnA));
    return half4(pre, half(outA));
}
`,
);

const HEIGHT = 46;

/**
 * Hex to the 0..1 triples the shader wants, resolved once at module scope.
 *
 * The colours come from the theme rather than being written here: `theme.ts` is the only
 * place in the app allowed to hold a colour. Kept as a tuple all the way to the uniform —
 * the same discipline the atmosphere layer needed after a mid-conversion string produced
 * `NaN` and painted nothing at all.
 */
const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const BURN = rgb(colors.burn);
const BURN_HI = rgb(colors.burnHi);
const RULE = rgb(colors.rule);

/** Below this the wait is short enough that a counter would be noise. */
const COUNT_FROM_SECONDS = 5;

type Props = {
  /** What the app is doing, in the user's words. */
  label: string;
};

export function Thinking({ label }: Props) {
  const clock = useClock();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const seconds = useElapsedSeconds();

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, HEIGHT],
    u_time: clock.get() / 1000,
    u_motion: reduced ? 0 : 1,
    u_burn: BURN,
    u_burnHi: BURN_HI,
    u_rule: RULE,
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  };

  return (
    <View style={styles.card}>
      <View style={styles.canvasRow} onLayout={onLayout}>
        {width > 0 ? (
          <Canvas style={{ width, height: HEIGHT }}>
            <Fill>
              <Shader source={RECORDER} uniforms={uniforms} />
            </Fill>
          </Canvas>
        ) : null}
      </View>

      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {seconds >= COUNT_FROM_SECONDS ? (
          <Text style={styles.elapsed}>{seconds} sn</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Whole seconds since mounting.
 *
 * One render a second, on the React Native runtime, which is the right place for it: the
 * number changes at 1Hz and driving it from the clock would re-render at 120.
 */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);

  return seconds;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.burn,
    paddingVertical: space.md,
    gap: space.sm,
  },
  canvasRow: { height: HEIGHT },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
  },
  label: { ...type.body, fontSize: size.caption, color: colors.inkDim },
  elapsed: { ...type.data, fontSize: 11, color: colors.inkDim },
});
