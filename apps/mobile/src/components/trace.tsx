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
};

export function Trace({ slice, width, height = 168, initialIndex, nowIndex }: Props) {
  const axisFont = useFont(PLEX, AXIS_SIZE);
  const start = Math.min(Math.max(initialIndex, 0), slice.count - 1);
  const [at, setAt] = useState(start);

  const plotBottom = height - AXIS_BAND;
  const step = slice.count > 1 ? width / (slice.count - 1) : width;

  const geometry = useMemo(
    () => buildGeometry(slice, { width, top: PAD_TOP, bottom: plotBottom, step }),
    [slice, width, plotBottom, step],
  );

  const index = useSharedValue(start);
  const commit = useCallback((next: number) => setAt(next), []);

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
      index.set(Math.min(Math.max(e.x / step, 0), count - 1));
    })
    .onUpdate((e) => {
      // Nothing is scheduled back to the RN runtime here — the reaction above owns that,
      // and only when a whole hour has been crossed.
      index.set(Math.min(Math.max(e.x / step, 0), count - 1));
    });

  const scrubX = at * step;
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
                path={verticalPath(nowIndex * step, PAD_TOP, plotBottom)}
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

function buildGeometry(
  slice: TraceSlice,
  plot: { width: number; top: number; bottom: number; step: number },
): Geometry {
  const y = (score: number) => plot.bottom - (score / 100) * (plot.bottom - plot.top);
  const x = (i: number) => i * plot.step;

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
        // Keep the last label inside the canvas instead of half off the edge.
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
