/**
 * The atmosphere layer.
 *
 * Weather happens *to* the instrument, not behind it: the sky is the paper the trace is
 * printed on. Ground and figure stay separated — the sky owns the far plane, fades into
 * the app's own ground before the trace begins, and never draws over it.
 *
 * ADR-0013 set the terms. Nothing here picks a state from a list; the forecast does.
 * Precipitation sets density, wind sets the angle every drop falls at, cloud cover
 * flattens the light, and the sun's real elevation moves the gradient. That is what
 * makes the layer a second reading of the same data rather than ornament — the only
 * footing an instrument direction would accept it on.
 *
 * Precipitation is one SkSL fragment shader, not a particle system: hundreds of drops
 * with no per-drop JavaScript, evaluated on the GPU and driven by a clock on the UI
 * runtime. The React tree never re-renders while it rains.
 */

import {
  Canvas,
  Fill,
  LinearGradient,
  Rect,
  Shader,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useDerivedValue } from "react-native-reanimated";

import { conditionFor, type Condition } from "@/lib/weather-code";
import { colors } from "@/theme";

/**
 * Rain, snow and hail from one shader, because they differ in physics rather than in
 * kind: a column grid, a hashed phase per column so nothing falls in lockstep, and a
 * distance field to the falling body. `u_mode` switches that body between a streak, a
 * swaying disc and a hard pellet.
 */
const PRECIPITATION = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_intensity;  // 0..1, from precipitation probability
uniform float  u_slant;      // -1..1, from wind
uniform float  u_mode;       // 0 rain, 1 snow, 2 hail
uniform float  u_fade;       // fraction of height at which the layer is gone

float hash(float n) { return fract(sin(n) * 43758.5453123); }

half4 main(float2 xy) {
    if (u_intensity <= 0.001) { return half4(0.0); }

    float2 uv = xy / u_resolution.y;
    float  columns = mix(14.0, 46.0, u_intensity);

    // Skewing the sampling grid is what makes wind visible: the whole field leans, so
    // drops stay parallel instead of each rotating about its own centre.
    float x = uv.x - uv.y * u_slant;
    float col = floor(x * columns);
    float seed = hash(col);

    // Columns the hash rejects stay empty, so lower density reads as fewer drops rather
    // than fainter ones — thinning by opacity looks like fog, not like light rain.
    if (seed > u_intensity * 0.95 + 0.05) { return half4(0.0); }

    float speed = u_mode < 0.5 ? 1.6 : (u_mode < 1.5 ? 0.28 : 2.3);
    float phase = fract(seed * 7.13 + u_time * speed * (0.75 + seed * 0.5));

    float cellX = fract(x * columns);
    float travel = fract(uv.y - phase);

    // Snow drifts sideways, and that oscillation is the whole difference between snow
    // and rain once both are falling.
    float sway = (u_mode > 0.5 && u_mode < 1.5)
        ? sin(u_time * 1.1 + seed * 30.0) * 0.28
        : 0.0;
    float dx = cellX - 0.5 + sway;

    float body;
    if (u_mode < 0.5) {
        body = smoothstep(0.06, 0.0, abs(dx)) * smoothstep(0.16, 0.0, travel);
    } else if (u_mode < 1.5) {
        float d = length(float2(dx, (travel - 0.05) * 1.6));
        body = smoothstep(0.055, 0.0, d);
    } else {
        float d = length(float2(dx, (travel - 0.03) * 1.15));
        body = smoothstep(0.035, 0.012, d);
    }

    // The layer stops before the instrument starts; the trace is never drawn through
    // weather.
    float fade = smoothstep(u_fade, u_fade * 0.55, xy.y / u_resolution.y);
    float alpha = body * fade * (0.30 + 0.45 * u_intensity);
    return half4(half3(0.82, 0.88, 0.95) * alpha, alpha);
}`)!;

/** Fraction of height at which the sky has fully become the app's ground. */
const FADE_AT = 0.62;

const MODE: Partial<Record<Condition, number>> = {
  "light-rain": 0,
  downpour: 0,
  storm: 0,
  snow: 1,
  hail: 2,
};

type Rgb = [number, number, number];

const NIGHT: Rgb = [11, 16, 32];
const DAY_TOP: Rgb = [44, 93, 147];
const NIGHT_LOW: Rgb = [20, 27, 51];
const DAY_LOW: Rgb = [110, 155, 192];
const OVERCAST_TOP: Rgb = [33, 39, 57];
const OVERCAST_LOW: Rgb = [43, 51, 70];
const BURN: Rgb = [196, 104, 44];

/**
 * Colour maths stays on tuples until the very last step.
 *
 * Mixing a value that is already a css string back into another mix is how the first
 * version of this silently produced `NaN` and painted nothing.
 */
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const css = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Zero at 06:30 and 19:30, peak at 13:00 — enough to move a gradient honestly. */
const elevation = (hour: number) => Math.max(0, Math.sin(((hour - 6.5) / 13) * Math.PI));

type Props = {
  /** Local hour on screen, which is what drives the sun's elevation. */
  localHour: number;
  weatherCode: number;
  precipProbPct: number;
  windKmh: number;
  cloudCoverPct: number;
};

export function Atmosphere({
  localHour,
  weatherCode,
  precipProbPct,
  windKmh,
  cloudCoverPct,
}: Props) {
  const clock = useClock();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const sky = useMemo(() => {
    const sun = elevation(localHour);
    const overcast = cloudCoverPct / 100;

    let top = mix(NIGHT, DAY_TOP, sun);
    let low = mix(NIGHT_LOW, DAY_LOW, sun);
    top = mix(top, OVERCAST_TOP, overcast * 0.72);
    low = mix(low, OVERCAST_LOW, overcast * 0.6);

    // A low sun brings the burn into the horizon band — which is where the palette came
    // from in the first place (docs/10).
    if (sun > 0 && sun < 0.34) {
      low = mix(low, BURN, ((0.34 - sun) / 0.34) * 0.38 * (1 - overcast * 0.5));
    }
    return { top: css(top), low: css(low) };
  }, [localHour, cloudCoverPct]);

  const condition = conditionFor(weatherCode);
  const mode = MODE[condition];
  const intensity =
    mode === undefined
      ? 0
      : Math.min(1, precipProbPct / 100 + (condition === "downpour" ? 0.35 : 0));
  const slant = Math.max(-0.6, Math.min(0.6, windKmh / 30));

  const uniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_intensity: intensity,
    u_slant: slant,
    u_mode: mode ?? 0,
    u_fade: FADE_AT,
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {size.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, size.height * FADE_AT)}
              colors={[sky.top, sky.low, colors.ground]}
              positions={[0, 0.8, 1]}
            />
          </Fill>
          {intensity > 0 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={PRECIPITATION} uniforms={uniforms} />
            </Rect>
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}
