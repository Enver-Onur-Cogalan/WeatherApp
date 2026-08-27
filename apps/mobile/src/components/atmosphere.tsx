/**
 * The atmosphere layer.
 *
 * Weather happens *to* the instrument, not behind it: the sky is the paper the trace is
 * printed on. Ground and figure stay separated — the sky owns the far plane, becomes the
 * app's own ground before the trace begins, and never draws over it.
 *
 * ADR-0013 set the terms. Nothing picks a state from a list; the forecast does.
 * Precipitation sets density, wind sets the angle drops fall at, cloud cover flattens
 * the light, and the sun's real elevation moves the gradient — which is what makes the
 * layer a second reading of the same data rather than ornament.
 *
 * It follows the **scrubbed** hour, not the current one. Dragging the trace changes the
 * weather behind it as well as the numbers in front, which is the promise the ADR was
 * written around and the first build quietly failed to keep.
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
 * Precipitation and fog from one shader, because they differ in physics rather than in
 * kind: a column grid, a hashed phase per column so nothing falls in lockstep, and a
 * distance field to the falling body. `u_mode` switches that body between a streak, a
 * swaying disc, a hard pellet and a drifting sheet.
 */
const WEATHER = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_intensity;  // 0..1
uniform float  u_slant;      // -1..1, from wind
uniform float  u_mode;       // 0 rain, 1 snow, 2 hail, 3 fog
uniform float  u_fade;       // fraction of height at which the layer is gone

float hash(float n) { return fract(sin(n) * 43758.5453123); }

half4 main(float2 xy) {
    if (u_intensity <= 0.001) { return half4(0.0); }

    float2 uv = xy / u_resolution.y;
    float  fade = smoothstep(u_fade, u_fade * 0.5, xy.y / u_resolution.y);
    if (fade <= 0.001) { return half4(0.0); }

    // Fog is sheets, not bodies: slow horizontal bands at different rates, which is
    // where its depth comes from.
    if (u_mode > 2.5) {
        float band = 0.0;
        for (float i = 0.0; i < 4.0; i += 1.0) {
            float y = 0.16 + i * 0.13;
            float drift = fract(u_time * (0.010 + i * 0.006) + i * 0.37);
            float across = smoothstep(0.30, 0.0, abs(fract(uv.x * 0.6 - drift) - 0.5));
            band += across * smoothstep(0.075, 0.0, abs(uv.y - y));
        }
        float a = clamp(band, 0.0, 1.0) * fade * u_intensity * 0.42;
        return half4(half3(0.86, 0.89, 0.93) * a, a);
    }

    float columns = mix(14.0, 46.0, u_intensity);

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

    float a = body * fade * (0.34 + 0.5 * u_intensity);
    return half4(half3(0.84, 0.90, 0.97) * a, a);
}`)!;

/**
 * Stars.
 *
 * Without them a clear night is a flat dark rectangle sitting on a dark ground — which
 * is exactly what the first build shipped, and why the layer looked like nothing had
 * been added. Cloud cover puts them out.
 */
const STARS = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_amount;   // 0..1, night times clear sky
uniform float  u_fade;

float hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

half4 main(float2 xy) {
    if (u_amount <= 0.01) { return half4(0.0); }

    float2 uv = xy / u_resolution.y;
    float  cells = 26.0;
    float2 id = floor(uv * cells);
    float2 cell = fract(uv * cells);

    float rnd = hash21(id);
    if (rnd > 0.34) { return half4(0.0); }

    float2 at = float2(hash21(id + 1.7), hash21(id + 4.1));
    float  d = length(cell - at);

    // Each star keeps its own twinkle rate, so the field never pulses as one.
    float twinkle = 0.55 + 0.45 * sin(u_time * (0.7 + rnd * 2.2) + rnd * 40.0);
    float body = smoothstep(0.06, 0.0, d) * twinkle;

    // Stars thin out toward the horizon rather than stopping at a line.
    float fade = smoothstep(u_fade, u_fade * 0.35, xy.y / u_resolution.y);
    float a = body * fade * u_amount * 0.9;
    return half4(half3(0.87, 0.91, 0.99) * a, a);
}`)!;


/**
 * Lightning.
 *
 * Timed entirely in the shader, so a storm needs no JavaScript at all — the alternative
 * is a timer on the RN runtime firing every few seconds for as long as the screen is
 * open, to change one number.
 *
 * Two details separate lightning from a blinking rectangle. Strikes are irregular:
 * time is cut into windows, a hash decides whether each one fires and when inside it,
 * so the rhythm never becomes a metronome. And each strike flickers — a hard flash, then
 * a weaker one about a tenth of a second later, which is what a real strike does and
 * what the eye is actually looking for.
 */
const LIGHTNING = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_active;   // 1 while the hour on screen is a thunderstorm
uniform float  u_fade;

// Integer hashing by an irrational stride rather than sin(): the window index grows
// without bound, and sin() loses its distribution long before the screen is closed.
float h1(float n) { return fract(n * 0.6180339887); }
float h2(float n) { return fract(n * 0.3819660113 + 0.37); }

half4 main(float2 xy) {
    if (u_active < 0.5) { return half4(0.0); }

    float period = 4.5;
    float window = floor(u_time / period);
    float t = u_time - window * period;

    float roll = h1(window);
    if (roll > 0.62) { return half4(0.0); }   // not every window strikes

    float at = 0.3 + roll * 2.6;
    float dt = t - at;
    if (dt < 0.0) { return half4(0.0); }

    float flash = exp(-dt * 9.0);
    float flicker = step(0.11, dt) * exp(-(dt - 0.11) * 14.0) * 0.55;
    float amount = clamp(flash + flicker, 0.0, 1.0);

    // Brightest where the cloud is, and off before the instrument starts.
    float vertical = smoothstep(u_fade, 0.0, xy.y / u_resolution.y);

    // A hashed horizontal centre, so successive strikes do not all light the same
    // part of the sky.
    float cx = 0.2 + h2(window) * 0.6;
    float across = 0.55 + 0.45 * smoothstep(0.75, 0.0, abs(xy.x / u_resolution.x - cx));

    float a = amount * vertical * across * 0.5;
    return half4(half3(0.94, 0.96, 1.0) * a, a);
}`)!;

/** Fraction of height at which the sky has fully become the app's ground. */
const FADE_AT = 0.62;

const MODE: Partial<Record<Condition, number>> = {
  "light-rain": 0,
  downpour: 0,
  storm: 0,
  snow: 1,
  hail: 2,
  fog: 3,
};

type Rgb = [number, number, number];

// Night is pulled away from the app's ground on purpose. The first version derived it
// from the same corner of the palette, so the sky and the page underneath it were within
// a few values of each other and the whole layer was invisible after sunset.
const NIGHT_TOP: Rgb = [7, 10, 24];
const NIGHT_LOW: Rgb = [30, 41, 74];
const DAY_TOP: Rgb = [38, 92, 152];
const DAY_LOW: Rgb = [124, 168, 204];
const OVERCAST_TOP: Rgb = [40, 46, 62];
const OVERCAST_LOW: Rgb = [78, 86, 100];
const BURN: Rgb = [196, 104, 44];

/**
 * Colour maths stays on tuples until the last step.
 *
 * Mixing a value that is already a css string back into another mix is how an earlier
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
  /** The hour on screen — scrubbed, not current. */
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

  const sun = elevation(localHour);
  const overcast = cloudCoverPct / 100;

  const sky = useMemo(() => {
    let top = mix(NIGHT_TOP, DAY_TOP, sun);
    let low = mix(NIGHT_LOW, DAY_LOW, sun);
    top = mix(top, OVERCAST_TOP, overcast * 0.7);
    low = mix(low, OVERCAST_LOW, overcast * 0.6);

    // A low sun brings the burn into the horizon band — where the palette came from
    // in the first place (docs/10).
    if (sun > 0 && sun < 0.34) {
      low = mix(low, BURN, ((0.34 - sun) / 0.34) * 0.45 * (1 - overcast * 0.5));
    }
    return { top: css(top), low: css(low) };
  }, [sun, overcast]);

  const condition = conditionFor(weatherCode);
  const mode = MODE[condition];
  const intensity =
    mode === undefined
      ? 0
      : condition === "fog"
        ? 0.85
        : Math.min(1, precipProbPct / 100 + (condition === "downpour" ? 0.35 : 0));
  const slant = Math.max(-0.6, Math.min(0.6, windKmh / 30));
  const starAmount = Math.max(0, 1 - sun * 6) * Math.max(0, 1 - overcast * 1.35);
  const storming = condition === "storm";

  const weatherUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_intensity: intensity,
    u_slant: slant,
    u_mode: mode ?? 0,
    u_fade: FADE_AT,
  }));

  const starUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_amount: starAmount,
    u_fade: FADE_AT,
  }));

  const lightningUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_active: storming ? 1 : 0,
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
              positions={[0, 0.82, 1]}
            />
          </Fill>

          {starAmount > 0.01 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={STARS} uniforms={starUniforms} />
            </Rect>
          ) : null}

          {intensity > 0 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={WEATHER} uniforms={weatherUniforms} />
            </Rect>
          ) : null}

          {/* Last, so a strike lights the rain in front of the sky rather than only
              the sky behind it. */}
          {storming ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={LIGHTNING} uniforms={lightningUniforms} />
            </Rect>
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}
