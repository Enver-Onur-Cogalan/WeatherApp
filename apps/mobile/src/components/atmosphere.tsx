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
  Blur,
  Canvas,
  Circle,
  Fill,
  Group,
  LinearGradient,
  Rect,
  Shader,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useDerivedValue } from "react-native-reanimated";

import { compileShader } from "@/lib/shader";
import { css, elevation, FADE_AT, skyStops } from "@/lib/sky";
import { conditionFor, hasThunder, type Condition } from "@/lib/weather-code";
import { colors } from "@/theme";

/**
 * Precipitation and fog from one shader, because they differ in physics rather than in
 * kind: a column grid, a hashed phase per column so nothing falls in lockstep, and a
 * distance field to the falling body. `u_mode` switches that body between a streak, a
 * swaying disc, a hard pellet and a drifting sheet.
 */
const WEATHER = compileShader(
  "weather",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_intensity;  // 0..1
uniform float  u_slant;      // -1..1, from wind
uniform float  u_mode;       // 0 rain, 1 snow, 2 hail, 3 fog, 4 freezing
uniform float  u_fade;       // fraction of height at which the layer is gone

float hash(float n) { return fract(sin(n) * 43758.5453123); }

half4 main(float2 xy) {
    if (u_intensity <= 0.001) { return half4(0.0); }

    float2 uv = xy / u_resolution.y;
    float  fade = smoothstep(u_fade, u_fade * 0.5, xy.y / u_resolution.y);
    if (fade <= 0.001) { return half4(0.0); }

    // Fog is sheets, not bodies: slow horizontal bands at different rates, which is
    // where its depth comes from.
    // Banded rather than open-ended: an open test owns every mode above it, so the first
    // one added after fog silently became fog.
    if (u_mode > 2.5 && u_mode < 3.5) {
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

    float speed = u_mode < 0.5 ? 1.6 : (u_mode < 1.5 ? 0.28 : (u_mode < 2.5 ? 2.3 : 2.0));
    float phase = fract(seed * 7.13 + u_time * speed * (0.75 + seed * 0.5));

    float cellX = fract(x * columns);
    float travel = fract(uv.y - phase);

    // Snow drifts sideways, and that oscillation is the whole difference between snow
    // and rain once both are falling.
    float sway = (u_mode > 0.5 && u_mode < 1.5)
        ? sin(u_time * 1.1 + seed * 30.0) * 0.28
        : 0.0;
    float dx = cellX - 0.5 + sway;

    // A round body has to be measured in pixels, not in the two different normalised
    // spaces its coordinates arrive in. dx is a fraction of one column and travel is a
    // fraction of the height, so at the forty-odd columns heavy precipitation asks for,
    // the horizontal axis is compressed some forty times against the vertical. Snow drawn
    // as length(dx, travel) therefore came out about half a pixel wide and twenty tall --
    // a streak, which is to say rain. Rain wants a streak, so it never showed the fault.
    float pxX = (dx / columns) * u_resolution.x;

    float body;
    if (u_mode < 0.5) {
        body = smoothstep(0.06, 0.0, abs(dx)) * smoothstep(0.16, 0.0, travel);
    } else if (u_mode < 1.5) {
        // A flake: round, and the same size whatever the density, because snow does not
        // get finer when there is more of it.
        float d = length(float2(pxX, (travel - 0.05) * u_resolution.y));
        body = smoothstep(2.6, 0.4, d);
    } else if (u_mode < 2.5) {
        // A pellet: smaller, harder edged, and falling fast enough to be a short dash.
        float d = length(float2(pxX, (travel - 0.03) * u_resolution.y * 0.75));
        body = smoothstep(2.0, 0.9, d);
    } else {
        // Freezing rain: a needle. Rain's streak, cut to half its length and drawn hard
        // at the edges, because what separates it from rain on a screen is not the fall
        // but the glassiness -- and a short bright stroke is what glass looks like.
        body = smoothstep(0.035, 0.0, abs(dx)) * smoothstep(0.075, 0.0, travel);
    }

    // Ice reads colder than water. The tint is the only cue a still frame has, since
    // freezing rain falls exactly like the rain it is.
    half3 tint = u_mode > 3.5 ? half3(0.62, 0.82, 0.90) : half3(0.84, 0.90, 0.97);
    float a = body * fade * (0.34 + 0.5 * u_intensity);
    return half4(tint * a, a);
}`)!;

/**
 * Stars.
 *
 * Without them a clear night is a flat dark rectangle sitting on a dark ground — which
 * is exactly what the first build shipped, and why the layer looked like nothing had
 * been added. Cloud cover puts them out.
 */
const STARS = compileShader(
  "stars",
  `
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
/**
 * Wind, which had no drawing at all.
 *
 * It was a parameter rather than a phenomenon: `windKmh` slanted falling precipitation and
 * did nothing else, so a clear gale looked exactly like a clear calm. That is the one gap
 * where the atmosphere stopped being a reading of the forecast (ADR-0013) and became a
 * reading of *some* of it.
 *
 * Drawn as gusts rather than as a steady stream. Air moving over a city is turbulent, and
 * a constant flow reads as a screensaver; each streak has its own start, speed and life,
 * and the field is empty between them. They are long, thin and low in contrast because
 * wind is a thing you infer from what it moves, and the alternative — visible lines
 * hurtling across a weather app — is the exact decoration ADR-0013 rules out.
 */
const WIND = compileShader(
  "wind",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_strength;   // 0..1, from km/h
uniform float  u_fade;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

half4 main(float2 xy) {
    if (u_strength <= 0.01) { return half4(0.0); }

    float2 uv = xy / u_resolution;
    float fade = smoothstep(u_fade, u_fade * 0.45, xy.y / u_resolution.y);
    if (fade <= 0.001) { return half4(0.0); }

    float total = 0.0;

    for (float i = 0.0; i < 16.0; i += 1.0) {
        float seed  = hash(i * 7.31);
        float phase = hash(i * 13.77 + 4.2);
        float band  = 0.04 + hash(i * 3.17) * 0.66;

        float speed = (0.05 + seed * 0.09) * (0.35 + u_strength * 1.6);
        float len   = (0.14 + seed * 0.26) * (0.45 + u_strength);

        float cycle = fract(u_time * speed + phase);
        float head  = cycle * 1.5 - 0.3;

        // Position along the streak: 0 at the leading edge, 1 at the tail.
        float t = (head - uv.x) / len;
        float within = smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.55, t);
        if (within <= 0.0) { continue; }

        // A gust is a wedge, not a bar. It is fullest just behind the leading edge and
        // thins to nothing at the tail — the earlier version kept one thickness the whole
        // way and read as a typed underscore.
        float thick = (0.0016 + seed * 0.0022) * (0.30 + 0.70 * (1.0 - t)) * (0.7 + u_strength * 0.6);

        // A slight sag along its length. Air does not travel in ruled lines, and the
        // wobble is what stops sixteen parallel streaks looking like a grid.
        float wobble = sin((uv.x + phase * 8.0) * 7.0 + phase * 6.28) * 0.010 * (1.0 - t)
                     + sin((uv.x + seed * 5.0) * 17.0) * 0.003;

        float dy = uv.y - (band + wobble);
        // Gaussian rather than a smoothstep edge: a hard-sided line at this width aliases
        // into a dotted row on any screen that is not exactly the size it was tuned on.
        float across = exp(-(dy * dy) / (thick * thick));

        // Brightest just behind the nose, fading back — the eye reads that as direction.
        float weight = within * (0.35 + 0.65 * smoothstep(0.55, 0.06, t));

        total += across * weight;
    }

    // Kept low on purpose. Wind is inferred from what it moves; streaks bright enough to
    // read as objects are the decoration ADR-0013 rules out.
    float a = clamp(total, 0.0, 1.0) * fade * (0.05 + u_strength * 0.16);
    return half4(half3(0.84, 0.89, 0.96) * a, a);
}
`,
);

/**
 * Cloud, for the three states that had none.
 *
 * `clear`, `partly` and `overcast` only ever moved the gradient's colour, so a sky at 90%
 * cover and a sky at 10% differed in tint and in nothing that moved. These are slow, soft
 * masses at several depths — closer to how cloud actually reads from the ground than
 * outlined shapes would be, and quiet enough to stay behind the trace.
 *
 * Deliberately not fog. Fog is low horizontal sheets at eye level; this is volume overhead,
 * and drawing them the same way would make two different readings look identical.
 */
const CLOUDS = compileShader(
  "clouds",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_cover;      // 0..1
uniform float  u_drift;      // wind, as horizontal rate
uniform float  u_fade;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123); }

float noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
               mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

half4 main(float2 xy) {
    if (u_cover <= 0.02) { return half4(0.0); }

    float2 uv = xy / u_resolution;
    float fade = smoothstep(u_fade, u_fade * 0.3, xy.y / u_resolution.y);
    if (fade <= 0.001) { return half4(0.0); }

    // Three octaves at different rates: the near layer moves fastest, which is the only
    // depth cue available without perspective.
    float t = u_time * (0.004 + u_drift * 0.02);
    float mass = noise(uv * float2(2.2, 4.5) + float2(t, 0.0)) * 0.55
               + noise(uv * float2(4.5, 8.0) - float2(t * 1.7, 0.0)) * 0.30
               + noise(uv * float2(9.0, 14.0) + float2(t * 2.6, 0.0)) * 0.15;

    // Cover raises the threshold rather than the opacity, so more cloud means *more of
    // the sky covered* rather than the same shapes painted harder.
    float lit = smoothstep(0.62 - u_cover * 0.42, 0.92 - u_cover * 0.30, mass);

    // Thinner toward the horizon: overhead is where a cloud presents its face.
    float overhead = smoothstep(0.85, 0.1, uv.y);

    float a = lit * overhead * fade * (0.10 + u_cover * 0.30);
    return half4(half3(0.88, 0.91, 0.96) * a, a);
}
`,
);

const LIGHTNING = compileShader(
  "lightning",
  `
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

/**
 * Heat, as the air above hot ground.
 *
 * Temperature was the one forecast field the layer never read. Five inputs went in --
 * hour, code, precipitation, wind, cloud -- and none of them separates minus ten from
 * forty-two, in an app whose entire question is whether a person should be outside. A day
 * that is dangerous to run in looked exactly like a pleasant one.
 *
 * Drawn as a shimmer band low in the frame rather than a tint over everything, because
 * that is where the effect actually is: air rising off ground that the sun has been on.
 * A runtime shader here cannot refract what is painted beneath it -- there is no backdrop
 * to sample -- so this is the shimmer itself, warm and thin, rather than a distortion of
 * the sky behind it.
 *
 * Cold gets nothing, deliberately. There is no optical phenomenon of cold air to draw,
 * and inventing one would be the ornament ADR-0013 refuses. Cold is already in the sky
 * palette and in the numbers.
 */
const HEAT = compileShader(
  "heat",
  `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_amount;  // 0..1, from temperature
uniform float  u_fade;    // where the sky meets the ground

half4 main(float2 xy) {
    float2 uv = xy / u_resolution;

    // Just under the horizon, falling off in both directions.
    float band = smoothstep(0.22, 0.0, abs(uv.y - (u_fade - 0.07)));
    if (band <= 0.0) { return half4(0.0); }

    // Columns, vertical and wavering. The first version mixed height into the phase,
    // which leaned them over and drew light beams rather than air -- heat rises straight
    // and wobbles, so the height belongs in the horizontal offset and nowhere else.
    float wob = sin(uv.y * 26.0 + u_time * 2.1) * 0.013
              + sin(uv.y * 41.0 - u_time * 1.5) * 0.008;
    float x = uv.x + wob;

    float a1 = sin(x * 36.0 + u_time * 0.85);
    float a2 = sin(x * 59.0 - u_time * 0.62);
    // Squared, so the field is wisps with gaps between them rather than an even ripple.
    float shimmer = pow((a1 * 0.6 + a2 * 0.4) * 0.5 + 0.5, 2.2);

    // Rising, so the band is denser at its base than at its top.
    float lift = smoothstep(0.0, 1.0, 1.0 - (uv.y - (u_fade - 0.29)) / 0.30);

    float a = band * shimmer * lift * u_amount * 0.20;
    return half4(half3(1.0, 0.80, 0.58) * a, a);
}`,
)!;

const MODE: Partial<Record<Condition, number>> = {
  "light-rain": 0,
  downpour: 0,
  storm: 0,
  snow: 1,
  hail: 2,
  fog: 3,
  freezing: 4,
};

type Props = {
  /** The hour on screen — scrubbed, not current. */
  localHour: number;
  weatherCode: number;
  precipProbPct: number;
  windKmh: number;
  cloudCoverPct: number;
  /** Degrees Celsius. Nothing below body heat draws anything; see `HEAT`. */
  temperatureC: number;
};

export function Atmosphere({
  localHour,
  weatherCode,
  precipProbPct,
  windKmh,
  cloudCoverPct,
  temperatureC,
}: Props) {
  const clock = useClock();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const sun = elevation(localHour);
  const overcast = cloudCoverPct / 100;

  // The stops come from `lib/sky`, which is also what decides the ink drawn on top of
  // them. Two implementations of this gradient would mean text adapting to a sky slightly
  // different from the one painted, which is worse than text that does not adapt.
  const sky = useMemo(() => {
    const stops = skyStops(localHour, cloudCoverPct);
    return { top: css(stops.top), low: css(stops.low) };
  }, [localHour, cloudCoverPct]);

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
  // The code, not the condition: 96 and 99 are thunderstorms whose falling body is hail,
  // so asking the condition got a silent sky on the two loudest codes in the set.
  const storming = hasThunder(weatherCode);

  // Nothing at all until it is genuinely hot, and full by the temperature at which the
  // engine's own profiles have long since excluded every hour. A gradient that started at
  // room temperature would be drawing on almost every summer day, which is how a reading
  // becomes wallpaper.
  const heat = Math.max(0, Math.min(1, (temperatureC - 28) / 12));

  /**
   * Where the sun or the moon is, and how much of it gets through.
   *
   * The layer drew stars, cloud, rain, snow, hail, fog, wind and lightning, and never the
   * one object everybody looks for. A clear day was an empty gradient.
   *
   * The path is the same curve `elevation` already uses, read sideways: horizontal
   * position is how far through its arc the body is, vertical position is how high it
   * climbed. So the sun rises where the day starts and sets where it ends, and the moon
   * does the same across the night — which is not an ephemeris, and is not pretending to
   * be one. It is the same honesty the gradient has: the shape of a day, not a claim about
   * a particular sky.
   */
  const daylight = sun > 0;

  // How far through its own arc the body is: thirteen hours of day from 06:30, eleven of
  // night from 19:30. Both run 0 to 1, which is what lets one piece of arithmetic put
  // either of them in the sky.
  const arc = daylight
    ? (localHour - 6.5) / 13
    : ((localHour + 24 - 19.5) % 24) / 11;

  // The same sine for both. The first version gave the moon a *fixed* height, so it slid
  // across at one altitude and never rose or set — the sun arced and the moon was on a
  // rail, which is the half of the cycle this was supposed to draw.
  const height = Math.max(0, Math.sin(Math.PI * arc));

  const body = {
    x: 0.08 + arc * 0.84,
    // High in its arc is near the top; at either end it sits on the horizon.
    y: 0.1 + (1 - height) * (FADE_AT - 0.16),
    // Nothing gets through an overcast deck, and nothing at all gets through weather.
    // Cloud cover alone was too weak a test: a sun stayed faintly visible through snow,
    // because a snowing sky is not always a fully clouded one in the forecast.
    show:
      condition === "clear" || condition === "partly"
        ? Math.max(0, 1 - overcast * 1.6)
        : 0,
  };

  const weatherUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_intensity: intensity,
    u_slant: slant,
    u_mode: mode ?? 0,
    u_fade: FADE_AT,
  }));

  const heatUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_amount: heat,
    u_fade: FADE_AT,
  }));

  const starUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_amount: starAmount,
    u_fade: FADE_AT,
  }));

  /**
   * Wind as a 0..1 strength.
   *
   * Saturating at 45 km/h: above that it is a storm and the precipitation shader is
   * already carrying the news, so a stronger gust field would only add noise on top of
   * something already loud. Below about 8 it is not visible weather and draws nothing —
   * a faint drift on a still day would be inventing a reading.
   */
  const gust = Math.max(0, Math.min(1, (windKmh - 8) / 37));

  const windUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_strength: gust,
    u_fade: FADE_AT,
  }));

  const cloudUniforms = useDerivedValue(() => ({
    u_resolution: [size.width, size.height],
    u_time: clock.get() / 1000,
    u_cover: overcast,
    u_drift: gust,
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

          {/* After the stars and before the cloud: nearer than one, behind the other. */}
          {body.show > 0.02 ? (
            <Group opacity={body.show}>
              <Group>
                {/* The halo, which is most of what a sun looks like. Brown-orange rather
                    than golden, for the reason docs/10 gives about the whole palette. */}
                <Blur blur={size.width * 0.06} />
                <Circle
                  cx={body.x * size.width}
                  cy={body.y * size.height}
                  r={size.width * (daylight ? 0.085 : 0.045)}
                  color={daylight ? colors.burn : colors.ruleSoft}
                />
              </Group>
              {/* The moon is drawn quieter than the sun rather than paler by accident.
                  Its path crosses the verdict, and a hard disc in the reading ink
                  competes with the numerals in front of it — which is the one thing the
                  far plane may never do (docs/10). A warm sun on a bright sky is already
                  low contrast; a bone-white moon on a night one is not. */}
              <Circle
                cx={body.x * size.width}
                cy={body.y * size.height}
                r={size.width * (daylight ? 0.042 : 0.024)}
                color={daylight ? colors.ink : colors.inkDim}
              />
            </Group>
          ) : null}

          {/* Cloud before precipitation, so rain falls in front of the mass it comes
              from rather than behind it. */}
          {overcast > 0.02 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={CLOUDS} uniforms={cloudUniforms} />
            </Rect>
          ) : null}

          {/* Under the precipitation and over the cloud: the haze is between the viewer
              and the horizon, and anything falling is nearer than both. */}
          {heat > 0.01 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={HEAT} uniforms={heatUniforms} />
            </Rect>
          ) : null}

          {intensity > 0 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={WEATHER} uniforms={weatherUniforms} />
            </Rect>
          ) : null}

          {/* Wind is not a condition — it blows in every one of them, which is why this
              is not inside the `MODE` switch. It was the one forecast field the layer
              read and never drew. */}
          {gust > 0.01 ? (
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <Shader source={WIND} uniforms={windUniforms} />
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
