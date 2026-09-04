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
 * Isobars, reorganising.
 *
 * The wait used to draw a recorder card scorching itself. That was right until the week
 * cards started drawing the same thing with real data — a loading state that looks like
 * the content it is loading stops reading as "working" and starts reading as "here is a
 * day", which is a lie for twenty-seven seconds.
 *
 * So this is the other thing an instrument produces: a pressure chart. Contours over a
 * field that keeps rewriting itself, which is what a forecast *is* — a surface being
 * solved. It is unmistakably meteorological without being a picture of weather, and
 * nothing else in the app looks like it.
 *
 * One honest detail falls out of the maths rather than being added. Contours crowd where
 * the field is steep and spread where it is flat, exactly as isobars do — so the tight
 * bands really are the windy parts of an imaginary chart. Nobody will read it that way,
 * and it is the reason the picture looks right.
 */
const ISOBARS = compileShader(
  "isobars",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_motion;    // 0 holds a still frame under reduced motion
uniform float3 u_line;      // the contours
uniform float3 u_front;     // the one line that leads

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123); }

/**
 * Value noise with quintic interpolation.
 *
 * The cubic smoothstep the rest of this file uses is C1: its second derivative jumps at
 * every cell boundary, which is invisible in a gradient and very visible in a contour —
 * the first attempt produced speckle rather than lines because of it. Quintic is C2, and
 * the level sets come out smooth.
 */
float noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
               mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

/** Two octaves. A third adds detail finer than the contour spacing, which is speckle. */
float field(float2 p, float t) {
    float v = noise(p + float2(t * 0.055, t * 0.03)) * 0.72;
    v += noise(p * 1.9 - float2(t * 0.08, t * 0.045)) * 0.28;
    return v;
}

half4 main(float2 xy) {
    float2 uv = xy / u_resolution;
    // Square the field's coordinates so features are not stretched by a wide, short card.
    float aspect = u_resolution.x / u_resolution.y;
    float2 p = float2(uv.x * aspect, uv.y) * 1.15;

    float t = u_motion > 0.5 ? u_time : 9.0;

    // A low-pressure centre the contours close around, drifting across. Without it the
    // field is texture; with it the chart has a subject.
    float2 eye = float2((0.5 + sin(t * 0.10) * 0.30) * aspect, 0.5 + cos(t * 0.07) * 0.18)
               * 1.15;
    float2 toEye = p - eye;
    float pull = 1.0 / (1.0 + dot(toEye, toEye) * 5.0);

    float v = field(p, t) + pull * 0.85;

    // Contours: the level sets of the field. The distance to the nearest one, measured in
    // field units, so lines crowd where the surface is steep — which is what isobars do,
    // and the reason the picture reads as a chart rather than as a pattern.
    float bands = v * 7.0;
    float d = abs(fract(bands) - 0.5);
    float line = smoothstep(0.030, 0.004, d);

    // Close to the centre the rings crowd past what a pixel can resolve and break into
    // dots. A real chart stops drawing them there too rather than printing a moiré, so
    // the innermost few fade out and leave the eye clean.
    line *= smoothstep(0.92, 0.62, pull);

    // One contour reads brighter, stepping outward through the set — a front crossing the
    // chart. It picks a *specific* ring rather than a phase: an earlier version offset the
    // same fract() the contours come from, so once a cycle the highlight lined up with
    // every line at once and the whole chart flashed amber. A ring index cannot do that.
    float ring = floor(bands);
    float sweep = mod(t * 0.5, 13.0) - 1.0;
    float front = line * smoothstep(1.2, 0.0, abs(ring - sweep));

    // Faded at the left and right so the chart sits inside the card rather than being cut
    // by it. Vertically it is allowed to run to the edges: the strip is short, and fading
    // both axes left a band floating in the middle.
    float vignette = smoothstep(0.0, 0.10, uv.x) * smoothstep(1.0, 0.90, uv.x);

    half3 rgb = mix(half3(u_line), half3(u_front), half(front));
    float a = (line * 0.55 + front * 0.45) * vignette;
    return half4(rgb * half(a), half(a));
}
`,
);

const HEIGHT = 84;

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

const LINE = rgb(colors.rule);
const FRONT = rgb(colors.burnHi);

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
    u_line: LINE,
    u_front: FRONT,
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
              <Shader source={ISOBARS} uniforms={uniforms} />
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
