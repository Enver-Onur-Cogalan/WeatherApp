/**
 * Three faces of the app, one per card of the tour.
 *
 * The first version drew one card and added a layer to it per page, which was the right
 * *idea* — the product builds up in that order — and the wrong drawing: three pages that
 * differ by one hairline read as the same picture three times. So each face is now its
 * own instrument mark, and they are distinct at a glance while sharing one vocabulary:
 * a ruled card, a pen, and the Campbell–Stokes scorch.
 *
 *   trace    a day's shape, drawn as a continuous line
 *   limits   three tracks, each scorched across the part you said you would accept
 *   window   the answer: one burnt span on a time axis
 *
 * **The sky behind them is the real one.** Each card runs the app's own atmosphere layer
 * on a named specimen — snow at midday, a storm at midnight, a cloudless afternoon — so
 * the tour shows the product working rather than a drawing of it. docs/10 puts it exactly
 * this way round: weather happens *to* the instrument, and the sky is the paper the trace
 * is printed on.
 *
 * **How this sits with ADR-0013.** That decision keeps the atmosphere only while it
 * encodes data, against the risk of it becoming ornament on the forecast surface. This is
 * not that surface and these are not forecasts: three fixed specimens, chosen to be
 * obviously not-today, driving the same shader from the same five inputs the real screen
 * uses. A demonstration of an encoding is a different act from a decorative sky — but it
 * is close enough to the line to be worth writing down rather than assumed.
 *
 * The marks in front claim nothing either: no day, no place, no figure, no axis label, and
 * shapes that are hand-placed constants rather than anything sampled.
 */

import { Blur, Canvas, Circle, Group, Path, Skia } from "@shopify/react-native-skia";

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT } from "@/lib/motion";
import { Atmosphere } from "@/components/atmosphere";
import { colors, radius } from "@/theme";

export type Face = "trace" | "limits" | "window";

/**
 * The weather each card is shown in.
 *
 * Deliberately three conditions that cannot all be true anywhere on one day: heavy snow at
 * noon, a thunderstorm at midnight, a clear evening. Nobody can mistake the set for a
 * forecast, and between them they exercise nearly everything the layer draws — falling
 * bodies, cloud deck, wind, lightning, stars, and the whole travel of the sun.
 *
 * The last hour is chosen rather than rounded. `elevation` puts the sun at zero at 19:30,
 * and just before that is the only moment the sky does two things at once: the horizon
 * still takes the burn, which is where this app's palette came from, and the stars are
 * already out above it. An hour either side gives one or the other.
 */
const SKIES: Record<Face, Specimen> = {
  trace: {
    localHour: 12,
    weatherCode: 73,
    precipProbPct: 90,
    windKmh: 14,
    cloudCoverPct: 92,
    temperatureC: -3,
  },
  limits: {
    localHour: 23,
    weatherCode: 95,
    precipProbPct: 100,
    windKmh: 58,
    cloudCoverPct: 100,
    temperatureC: 16,
  },
  window: {
    localHour: 19.3,
    weatherCode: 0,
    precipProbPct: 0,
    windKmh: 5,
    cloudCoverPct: 4,
    temperatureC: 24,
  },
};

type Specimen = {
  localHour: number;
  weatherCode: number;
  precipProbPct: number;
  windKmh: number;
  cloudCoverPct: number;
  temperatureC: number;
};

/**
 * The shape of a day, as a comfort score.
 *
 * Cool early, a good morning, the middle lost to heat, a second window before dark. Hand
 * placed rather than sampled: a real day would be a claim about a real place, and this
 * needs to be recognisably *a day* and nothing more.
 */
const SHAPE = [0.18, 0.5, 0.86, 0.72, 0.3, 0.16, 0.44, 0.78, 0.6, 0.24];

/** Three limits, as the fraction of each track a person said they would accept. */
const TRACKS = [
  { from: 0.18, to: 0.68 },
  { from: 0.0, to: 0.42 },
  { from: 0.0, to: 0.3 },
];

const PAD = 16;

export function TourCard({ face, lit }: { face: Face; lit: boolean }) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;

  // Two values, both on the UI runtime: the pen crossing the card, and the scorch that
  // lands behind it. One timeline per face rather than one per element.
  const drawn = useSharedValue(reduced ? 1 : 0);
  const burnt = useSharedValue(reduced ? 1 : 0);

  // In an effect, never in render. A shared value written during reconciliation fires
  // mid-render and is replayed by any re-render the component did not cause — the one
  // rule about shared values that fails silently rather than loudly.
  useEffect(() => {
    if (!lit || reduced) return;
    drawn.set(withTiming(1, { duration: 820, easing: EASE_OUT }));
    burnt.set(withDelay(360, withTiming(1, { duration: 620, easing: EASE_OUT })));
  }, [lit, reduced, drawn, burnt]);

  const paths = useMemo(
    () => (width > 0 && height > 0 ? build(face, width, height) : null),
    [face, width, height],
  );

  // Everything is revealed left to right, because that is how a recorder writes and
  // because it makes the marks read as drawn rather than placed.
  const pen = useAnimatedStyle(() => ({ width: width * drawn.get() }));
  const scorch = useAnimatedStyle(() => ({ width: width * burnt.get() }));

  return (
    <View
      style={styles.card}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        // Guarded: `onLayout` fires on every pass and an unconditional setState here is
        // a render loop.
        if (next.width > 0 && (next.width !== width || next.height !== height)) {
          setSize({ width: next.width, height: next.height });
        }
      }}
    >
      <Atmosphere {...SKIES[face]} />

      {paths === null ? null : (
        <>
          {/* The card is ruled before anything is written on it. */}
          <Canvas style={{ width, height }}>
            <Path
              path={paths.rules}
              color={colors.ruleSoft}
              style="stroke"
              strokeWidth={1}
            />
          </Canvas>

          <Animated.View style={[StyleSheet.absoluteFill, pen, styles.clip]}>
            <Canvas style={{ width, height }}>
              <Path
                path={paths.ink}
                color={colors.ink2}
                style="stroke"
                strokeWidth={2}
                strokeCap="round"
              />
            </Canvas>
          </Animated.View>

          <Animated.View style={[StyleSheet.absoluteFill, scorch, styles.clip]}>
            <Canvas style={{ width, height }}>
              <Group>
                <Blur blur={7} />
                <Path
                  path={paths.burns}
                  color={colors.burn}
                  style="stroke"
                  strokeWidth={9}
                  strokeCap="round"
                />
              </Group>
              <Path
                path={paths.burns}
                color={colors.burnHi}
                style="stroke"
                strokeWidth={2.5}
                strokeCap="round"
              />
              {paths.pick ? (
                <Circle cx={paths.pick.x} cy={paths.pick.y} r={4} color={colors.burnHi} />
              ) : null}
            </Canvas>
          </Animated.View>
        </>
      )}
    </View>
  );
}

/**
 * The marks for one face.
 *
 * `ink` is what the pen draws and `burns` is what the light scorches, so the two arrive
 * on their own timings. Every face fills both, which is what keeps them siblings rather
 * than three unrelated pictures.
 */
function build(face: Face, width: number, height: number) {
  const top = PAD;
  const bottom = height - PAD;
  const span = bottom - top;
  const left = PAD;
  const right = width - PAD;

  const rules = Skia.Path.Make();
  const ink = Skia.Path.Make();
  const burns = Skia.Path.Make();
  let pick: { x: number; y: number } | null = null;

  if (face === "trace") {
    // A day, as a line, and nothing else. The scorch belongs to the next face: amber is
    // what a *limit* produces, and burning hours here would answer a question the page
    // has not asked yet.
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (span / 4) * i;
      rules.moveTo(left, y);
      rules.lineTo(right, y);
    }

    const step = (right - left) / (SHAPE.length - 1);
    const xAt = (i: number) => left + i * step;
    const yAt = (v: number) => bottom - v * span;

    ink.moveTo(xAt(0), yAt(SHAPE[0]));
    for (let i = 1; i < SHAPE.length; i += 1) {
      // A smooth join rather than a polyline: the instrument draws with a pen, and the
      // corners of a polyline read as a chart.
      const cx = (xAt(i - 1) + xAt(i)) / 2;
      ink.cubicTo(cx, yAt(SHAPE[i - 1]), cx, yAt(SHAPE[i]), xAt(i), yAt(SHAPE[i]));
    }
  } else if (face === "limits") {
    // Three tracks, one per limit. The scorch is the range you accepted, so the drawing
    // says "you chose these" rather than "here is a measurement".
    const gap = span / 3;
    TRACKS.forEach((track, row) => {
      const y = top + gap * row + gap / 2;
      rules.moveTo(left, y);
      rules.lineTo(right, y);

      // A tick at each end, so a track reads as a scale with two ends rather than a line.
      for (const x of [left, right]) {
        ink.moveTo(x, y - 5);
        ink.lineTo(x, y + 5);
      }

      burns.moveTo(left + (right - left) * track.from, y);
      burns.lineTo(left + (right - left) * track.to, y);
    });
  } else {
    // The answer: one span on a day, with the hours either side left cold.
    const axis = bottom - span * 0.32;
    rules.moveTo(left, axis);
    rules.lineTo(right, axis);

    // Hour ticks, unlabelled. They give the span something to be a span *of*.
    for (let i = 0; i <= 8; i += 1) {
      const x = left + ((right - left) / 8) * i;
      ink.moveTo(x, axis + 4);
      ink.lineTo(x, axis + (i % 2 === 0 ? 10 : 7));
    }

    const from = left + (right - left) * 0.28;
    const to = left + (right - left) * 0.52;
    burns.moveTo(from, axis);
    burns.lineTo(to, axis);
    pick = { x: (from + to) / 2, y: axis - 18 };

    // The mark that says "this one" — a stem down to the span it points at.
    ink.moveTo(pick.x, pick.y + 5);
    ink.lineTo(pick.x, axis - 4);
  }

  return { rules, ink, burns, pick };
}

const styles = StyleSheet.create({
  card: {
    // Square. A tall rectangle read as a panel with a picture in it; a square reads as
    // the thing itself, and it is the shape a sky needs to be legible as one.
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.ground2,
    overflow: "hidden",
  },
  clip: { overflow: "hidden" },
});
