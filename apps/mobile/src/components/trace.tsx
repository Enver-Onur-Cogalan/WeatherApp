/**
 * The comfort trace for one day — the spine of the app.
 *
 * What it plots is not temperature but the composite comfort score for the active
 * activity profile, which is why the same day is a different landscape for running than
 * for cycling (docs/10).
 *
 * Two rules hold the performance together. The path is built once per slice, never
 * inside a gesture. And the readout re-renders on the *hour boundary* rather than every
 * frame: a `useAnimatedReaction` fires when the rounded index changes, which is at most
 * 24 renders across a full drag instead of 120 a second.
 */

import {
  Canvas,
  Group,
  Path,
  Skia,
  Text as SkText,
  useFont,
  type SkPath,
} from "@shopify/react-native-skia";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { TraceSlice } from "@/lib/plan";
import { conditionLabel } from "@/lib/weather-code";
import { colors, size, space, type } from "@/theme";

const PLEX = require("@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf");

const PAD_TOP = 16;

/**
 * How far the first and last hour sit in from the screen edge.
 *
 * The trace used to be plotted edge to edge, which read well and was close to unusable at
 * both ends. With 24 hours across a 390dp screen a step is about 17dp, and the outermost
 * hours own only *half* a step each — so 00:00 was an 8dp target pressed against the
 * bezel, inside the band where Android's back gesture and iOS's screen-edge pan live.
 *
 * Twenty-four rather than a round twenty, because that is Android's own system gesture
 * inset: the first data point then sits exactly outside the band the platform reserves,
 * instead of a few pixels inside it. With the clamp in the gesture below it also gives
 * 00:00 a capture band from the very edge to 24 + half a step — about 31dp, three and a
 * half times what it had. The two hardest hours to hit become the two easiest.
 *
 * During a drag the ends are effectively infinite targets, since anything past the last
 * point holds there. The number matters for a cold tap, which is the case that was hard.
 *
 * The cost is 12% of the width and the full-bleed the design liked (docs/10). A spine you
 * cannot touch at either end is worse than a spine with margins.
 *
 * Rejected on the way: a non-linear x mapping that would keep the bleed and widen the end
 * bands. It buys reachability by making the time axis non-uniform, and a time series whose
 * x-axis lies about time is a worse trade than a margin.
 */
const PLOT_INSET = 24;
const AXIS_BAND = 26;
const STROKE = 2.5;
const AXIS_SIZE = 10;

type Props = {
  slice: TraceSlice;
  width: number;
  height?: number;
  /** Index the scrubber opens on, usually the start of the best window. */
  initialIndex: number;
  /** The hour happening now within this slice, or null when the day is not today. */
  nowIndex?: number | null;
  /** Reports the scrubbed hour so the atmosphere can follow it (ADR-0013). Fires on
   *  hour boundaries only, which is what the reaction below already costs. */
  onScrub?: (index: number) => void;
};

export function Trace({
  slice,
  width,
  height = 168,
  initialIndex,
  nowIndex,
  onScrub,
}: Props) {
  const axisFont = useFont(PLEX, AXIS_SIZE);
  const start = Math.min(Math.max(initialIndex, 0), slice.count - 1);
  const [at, setAt] = useState(start);

  const plotBottom = height - AXIS_BAND;
  const plotWidth = Math.max(1, width - PLOT_INSET * 2);
  const step = slice.count > 1 ? plotWidth / (slice.count - 1) : plotWidth;

  /**
   * Where an hour sits, and the only place that is decided.
   *
   * It was three places — the geometry, the scrub marker and the now marker — and the now
   * marker was the one that did not get the inset when it was introduced, so it pointed a
   * whole inset to the left of the hour it named. One function is the fix for the class,
   * not just for the instance.
   */
  const xAt = (i: number) => PLOT_INSET + i * step;

  const geometry = useMemo(
    () =>
      buildGeometry(slice, {
        width,
        inset: PLOT_INSET,
        top: PAD_TOP,
        bottom: plotBottom,
        step,
      }),
    [slice, width, plotBottom, step],
  );

  const index = useSharedValue(start);
  const commit = useCallback(
    (next: number) => {
      setAt(next);
      onScrub?.(next);
    },
    [onScrub],
  );

  // Renders only when the hour under the finger changes, not on every frame.
  useAnimatedReaction(
    () => Math.round(index.get()),
    (next, previous) => {
      if (next !== previous) scheduleOnRN(commit, next);
    },
  );

  const count = slice.count;
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      index.set(atX(e.x, step, count));
    })
    .onUpdate((e) => {
      // Nothing is scheduled back to the RN runtime here — the reaction above owns that,
      // and only when a whole hour has been crossed.
      index.set(atX(e.x, step, count));
    });

  const scrubX = xAt(at);
  const scrubY = plotBottom - (slice.scores[at] / 100) * (plotBottom - PAD_TOP);

  return (
    <View>
      <Readout slice={slice} at={at} />

      <GestureDetector gesture={pan}>
        <View style={[styles.stage, { height }]} collapsable={false}>
          <Canvas style={{ width, height }}>
            {geometry.grid.map((line) => (
              <Group key={line.x}>
                <Path
                  path={line.path}
                  style="stroke"
                  strokeWidth={1}
                  color={line.major ? colors.rule : colors.ruleSoft}
                />
                {axisFont ? (
                  <SkText
                    x={line.labelX}
                    y={height - 9}
                    text={line.label}
                    font={axisFont}
                    color={colors.inkDim}
                  />
                ) : null}
              </Group>
            ))}

            {geometry.burnFills.map((fill, i) => (
              <Path key={`fill-${i}`} path={fill} color={colors.burnWash} />
            ))}

            <Path path={geometry.line} style="stroke" strokeWidth={STROKE} color={colors.ink} />

            {geometry.burnLines.map((burn, i) => (
              <Path
                key={`burn-${i}`}
                path={burn}
                style="stroke"
                strokeWidth={STROKE * 1.8}
                color={colors.burnHi}
                strokeCap="round"
              />
            ))}

            {/* Where the day actually is, so the trace is oriented before it is read. */}
            {nowIndex != null ? (
              <Path
                path={verticalPath(xAt(nowIndex), PAD_TOP, plotBottom)}
                style="stroke"
                strokeWidth={1}
                color={colors.burn}
              />
            ) : null}

            <Path
              path={verticalPath(scrubX, 0, plotBottom + 4)}
              style="stroke"
              strokeWidth={1}
              color={colors.ink}
            />
            <Path path={dotPath(scrubX, scrubY, 4.5)} color={colors.ink} />
          </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * The values at the scrubbed hour, as ordinary React text.
 *
 * Drawing these in Skia from a `SharedValue<string>` is what crashed the screen on
 * device: Skia's animated props carry numbers, and handing `<Text>` an animated string
 * takes the native side down with no JavaScript error to catch.
 */
function Readout({ slice, at }: { slice: TraceSlice; at: number }) {
  const hour = String(slice.localHours[at]).padStart(2, "0");
  const score = Math.round(slice.scores[at]);

  return (
    <View style={styles.readout}>
      <View style={styles.readoutHead}>
        <Text style={styles.hour}>{hour}:00</Text>
        <Text style={styles.condition}>{conditionLabel(slice.weatherCodes[at])}</Text>
        <Text style={[styles.score, score >= 75 && styles.scoreGood]}>skor {score}</Text>
      </View>
      <View style={styles.values}>
        <Value label="Sıcaklık" value={`${slice.temperature[at].toFixed(1)}°`} />
        <Value label="Rüzgâr" value={String(Math.round(slice.wind[at]))} unit="km/h" cool />
        <Value label="Yağış" value={`%${slice.precipitation[at]}`} />
        <Value label="UV" value={String(Math.round(slice.uv[at]))} />
      </View>
    </View>
  );
}

function Value({
  label,
  value,
  unit,
  cool,
}: {
  label: string;
  value: string;
  unit?: string;
  cool?: boolean;
}) {
  return (
    <View style={styles.value}>
      <Text style={[styles.valueNum, cool && styles.valueCool]}>
        {value}
        {unit ? <Text style={styles.valueUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.valueLabel}>{label}</Text>
    </View>
  );
}

type GridLine = {
  x: number;
  labelX: number;
  label: string;
  major: boolean;
  path: SkPath;
};

type Geometry = {
  line: SkPath;
  burnFills: SkPath[];
  burnLines: SkPath[];
  grid: GridLine[];
};

/**
 * Which hour a touch at `x` means.
 *
 * A worklet: this runs on the UI runtime inside the pan handler, and a function called
 * from one without the directive throws at runtime on device while working fine in the
 * debugger.
 *
 * The clamp is what makes the margins useful rather than dead. Everything left of the
 * first point resolves to hour 0 and everything right of the last to hour 23, so dragging
 * into the bezel holds at the end instead of doing nothing.
 */
function atX(x: number, step: number, count: number): number {
  "worklet";
  return Math.min(Math.max((x - PLOT_INSET) / step, 0), count - 1);
}

function buildGeometry(
  slice: TraceSlice,
  plot: { width: number; inset: number; top: number; bottom: number; step: number },
): Geometry {
  const y = (score: number) => plot.bottom - (score / 100) * (plot.bottom - plot.top);
  const x = (i: number) => plot.inset + i * plot.step;

  const line = Skia.Path.Make();
  slice.scores.forEach((score, i) => {
    if (i === 0) line.moveTo(x(i), y(score));
    else line.lineTo(x(i), y(score));
  });

  const burnFills: SkPath[] = [];
  const burnLines: SkPath[] = [];
  for (let i = 0; i < slice.burns.length; i += 2) {
    const from = slice.burns[i];
    const to = slice.burns[i + 1];

    const fill = Skia.Path.Make();
    fill.moveTo(x(from), plot.bottom);
    for (let h = from; h <= to; h += 1) fill.lineTo(x(h), y(slice.scores[h]));
    fill.lineTo(x(to), plot.bottom);
    fill.close();
    burnFills.push(fill);

    const stroke = Skia.Path.Make();
    for (let h = from; h <= to; h += 1) {
      if (h === from) stroke.moveTo(x(h), y(slice.scores[h]));
      else stroke.lineTo(x(h), y(slice.scores[h]));
    }
    burnLines.push(stroke);
  }

  // Every six hours, heavier at midnight — the day boundary is information, not decoration.
  const grid: GridLine[] = slice.localHours
    .map((hour, i) => ({ hour, i }))
    .filter(({ hour }) => hour % 6 === 0)
    .map(({ hour, i }) => {
      const px = x(i);
      return {
        x: px,
        // Keep the last label inside the canvas instead of half off the edge. The first
        // one no longer needs a floor: the inset already holds it clear.
        labelX: Math.min(px + 4, plot.width - 18),
        label: `${String(hour).padStart(2, "0")}:00`,
        major: hour === 0,
        path: verticalPath(px, 0, plot.bottom + 4),
      };
    });

  return { line, burnFills, burnLines, grid };
}

function verticalPath(x: number, from: number, to: number): SkPath {
  const p = Skia.Path.Make();
  p.moveTo(x, from);
  p.lineTo(x, to);
  return p;
}

function dotPath(cx: number, cy: number, r: number): SkPath {
  const p = Skia.Path.Make();
  p.addCircle(cx, cy, r);
  return p;
}

const styles = StyleSheet.create({
  stage: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },

  readout: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  readoutHead: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  hour: { ...type.data, fontSize: 22, color: colors.burnHi },
  condition: { ...type.body, fontSize: size.caption, color: colors.ink2, flex: 1 },
  score: { ...type.label, fontSize: 9, color: colors.inkDim },
  scoreGood: { color: colors.burn },

  values: { flexDirection: "row", gap: space.xl },
  value: { gap: 1 },
  valueNum: { ...type.data, fontSize: size.body, color: colors.ink },
  valueCool: { color: colors.glacial },
  valueUnit: { ...type.data, fontSize: 10, color: colors.inkDim },
  valueLabel: { ...type.label, fontSize: 9, color: colors.inkDim },
});
