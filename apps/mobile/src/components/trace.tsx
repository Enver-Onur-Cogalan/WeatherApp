/**
 * The comfort trace — the spine of the app.
 *
 * What it plots is not temperature but the composite comfort score for the active
 * activity profile, which is why the same week is a different landscape for running
 * than for cycling (docs/10).
 *
 * Everything that moves lives on the UI runtime. The path is built once per slice and
 * never rebuilt while a finger is down; only the scrubber's position changes per frame,
 * and the readout is drawn in Skia from derived values so no React render is involved
 * in dragging.
 */

import {
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Path,
  Skia,
  Text as SkText,
  useFont,
  vec,
} from "@shopify/react-native-skia";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import type { TraceSlice } from "@/lib/plan";
import { colors } from "@/theme";

const PLEX = require("@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf");

const PAD_TOP = 22;
const PAD_BOTTOM = 34;
const AXIS_SIZE = 11;
const READOUT_SIZE = 15;
const STROKE = 2.5;

type Props = {
  slice: TraceSlice;
  height?: number;
  width: number;
  /** Index the scrubber opens on, usually the start of the best window. */
  initialIndex: number;
};

export function Trace({ slice, width, height = 190, initialIndex }: Props) {
  const axisFont = useFont(PLEX, AXIS_SIZE);
  const readoutFont = useFont(PLEX, READOUT_SIZE);

  const plot = useMemo(
    () => ({
      top: PAD_TOP,
      bottom: height - PAD_BOTTOM,
      step: slice.count > 1 ? width / (slice.count - 1) : width,
    }),
    [width, height, slice.count],
  );

  const y = useMemo(() => {
    const span = plot.bottom - plot.top;
    return (score: number) => plot.bottom - (score / 100) * span;
  }, [plot]);

  /**
   * Built once per slice. Rebuilding a 168-point path inside a gesture handler is the
   * difference between a trace that tracks the finger and one that lags it.
   */
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    slice.scores.forEach((score, i) => {
      const px = i * plot.step;
      const py = y(score);
      if (i === 0) p.moveTo(px, py);
      else p.lineTo(px, py);
    });
    return p;
  }, [slice, plot, y]);

  /** The scorch under each open window, clipped to that run of hours. */
  const burnPaths = useMemo(() => {
    const out: { fill: ReturnType<typeof Skia.Path.Make>; from: number; to: number }[] = [];
    for (let i = 0; i < slice.burns.length; i += 2) {
      const start = slice.burns[i];
      const end = slice.burns[i + 1];
      const fill = Skia.Path.Make();
      fill.moveTo(start * plot.step, plot.bottom);
      for (let h = start; h <= end; h += 1) fill.lineTo(h * plot.step, y(slice.scores[h]));
      fill.lineTo(end * plot.step, plot.bottom);
      fill.close();
      out.push({ fill, from: start * plot.step, to: end * plot.step });
    }
    return out;
  }, [slice, plot, y]);

  /** Midnight is heavier than the other six-hour marks; the day boundary is information. */
  const gridlines = useMemo(
    () =>
      slice.localHours
        .map((hour, i) => ({ hour, x: i * plot.step }))
        .filter(({ hour }) => hour % 6 === 0),
    [slice, plot],
  );

  const index = useSharedValue(Math.min(initialIndex, slice.count - 1));

  const pan = Gesture.Pan()
    .onBegin((e) => {
      index.set(clampIndex(e.x / step, count));
    })
    .onUpdate((e) => {
      // No scheduleOnRN here. At 120 Hz this fires twice a frame, and anything crossing
      // to the RN runtime from inside onUpdate is the classic way to make a drag stutter.
      index.set(clampIndex(e.x / step, count));
    })
    .onEnd(() => {
      index.set(withSpring(Math.round(index.get()), { duration: 220, dampingRatio: 1 }));
    });

  // Worklets capture primitives, never helpers. `y` is an ordinary function built on
  // the RN runtime with useMemo, and calling it from a worklet throws on device while
  // working fine in the debugger — so the same mapping is done inline from numbers.
  const plotTop = plot.top;
  const plotBottom = plot.bottom;
  const step = plot.step;
  const scores = slice.scores;
  const count = slice.count;

  const scrubX = useDerivedValue(() => index.get() * step);
  const scrubY = useDerivedValue(() => {
    const at = Math.min(Math.max(Math.round(index.get()), 0), count - 1);
    const score = scores[at] ?? 0;
    return plotBottom - (score / 100) * (plotBottom - plotTop);
  });

  // Hooks stay at the top level — a `useDerivedValue` inlined into a JSX prop happens
  // to evaluate in a stable order here, but it is a rule violation waiting to bite.
  // Plain object literals rather than Skia's `vec`: a helper from another module is one
  // more thing that has to be worklet-safe, and a Vector is only {x, y}.
  const scrubTop = useDerivedValue(() => ({ x: scrubX.get(), y: 0 }));
  const scrubFoot = useDerivedValue(() => ({ x: scrubX.get(), y: plotBottom + 6 }));
  const readout = useReadout(index, slice);

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.wrap, { height }]}>
        <Canvas style={{ width, height }}>
          {gridlines.map(({ hour, x }) => (
            <Group key={x}>
              <Line
                p1={vec(x, 0)}
                p2={vec(x, plot.bottom + 6)}
                color={hour === 0 ? colors.rule : colors.ruleSoft}
                strokeWidth={1}
              />
              {axisFont ? (
                <SkText
                  x={x + 5}
                  y={height - 12}
                  text={String(hour).padStart(2, "0")}
                  font={axisFont}
                  color={colors.inkDim}
                />
              ) : null}
            </Group>
          ))}

          {burnPaths.map(({ fill, from }) => (
            <Path key={from} path={fill}>
              <LinearGradient
                start={vec(0, plot.top)}
                end={vec(0, plot.bottom)}
                colors={[colors.burnWash, "rgba(196,104,44,0)"]}
              />
            </Path>
          ))}

          <Path path={path} style="stroke" strokeWidth={STROKE} color={colors.ink} />

          {burnPaths.map(({ fill, from, to }) => (
            <Group key={`burn-${from}`} clip={{ x: from, y: 0, width: to - from, height }}>
              <Path
                path={path}
                style="stroke"
                strokeWidth={STROKE * 1.6}
                color={colors.burnHi}
                strokeCap="round"
              />
            </Group>
          ))}

          <Line p1={scrubTop} p2={scrubFoot} color={colors.ink} strokeWidth={1} />
          <Circle cx={scrubX} cy={scrubY} r={4.5} color={colors.ink} />

          {readoutFont ? (
            <SkText x={0} y={14} text={readout} font={readoutFont} color={colors.ink} />
          ) : null}
        </Canvas>
      </View>
    </GestureDetector>
  );
}

function clampIndex(raw: number, count: number): number {
  "worklet";
  return Math.min(Math.max(raw, 0), count - 1);
}

/**
 * The readout, composed on the UI runtime and drawn by Skia.
 *
 * Rendering these four values as React `<Text>` would mean a render per frame while
 * dragging — the single biggest cause of jank in a React Native gesture.
 */
function useReadout(index: SharedValue<number>, slice: TraceSlice) {
  return useDerivedValue(() => {
    const at = Math.min(Math.max(Math.round(index.get()), 0), slice.count - 1);
    const hour = String(slice.localHours[at]).padStart(2, "0");
    const temp = slice.temperature[at].toFixed(1);
    const wind = Math.round(slice.wind[at]);
    const rain = slice.precipitation[at];
    return `${hour}:00   ${temp}°   ${wind} km/h   %${rain}`;
  });
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
});
