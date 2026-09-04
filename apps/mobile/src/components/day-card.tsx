/**
 * One day, as a card from the recorder.
 *
 * The calendar's first drawing was a list row with a small bar chart under it — correct,
 * and indistinguishable from any other weather app. This is the instrument instead: a
 * Campbell–Stokes card is ruled stock with a scorch burned across it by focused sunlight,
 * and that is exactly what a day is here. The loading state already draws this card with
 * nothing on it (`thinking.tsx`); these are the same card with a real day on them, which
 * ties three surfaces — the wait, the trace and the week — into one object seen at three
 * sizes.
 *
 * The signature is the arrival. Each card burns its own day in, left to right, staggered
 * down the screen — the drum turning through a week. It is the one animation in the app
 * that is allowed to be noticed, because it happens once per visit to a screen rather than
 * dozens of times a session, which is the tier the guidance reserves for delight.
 *
 * Skia here, against the earlier judgement that twenty-four rectangles do not need a
 * canvas. The judgement was right for what it was drawing; the goal changed. A scorch has
 * a bloom and a heat gradient, and flat views cannot make one — the reason for a canvas is
 * the glow, not the rectangles.
 *
 * ## What was taken out
 *
 * The first version of this card carried eleven things: weekday, date, high, low,
 * condition, a temperature bar, the burn, an hour axis, open hours, the best span, the
 * score and the wind. Every one of them was defensible on its own and the card was tiring
 * to look at, which is the usual way a screen goes wrong — not one bad decision but eleven
 * reasonable ones stacked.
 *
 * Five remain. The graphic is the card's argument, so everything that competed with it is
 * gone: the temperature bar said what two numbers already say, the axis labels said what
 * the span underneath says exactly, and the condition, score and wind are all one tap away
 * on İz. A card answers *which day*; the trace answers *why*, and it does not have to be
 * answered twice.
 */

import {
  Blur,
  Canvas,
  Group,
  Path,
  Skia,
  type SkPath,
} from "@shopify/react-native-skia";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT } from "@/lib/motion";
import { formatWindowSpan, type ScoredHour, type Window } from "@/lib/plan";
import { conditionLabel, isSevere } from "@/lib/weather-code";
import { colors, radius, space, type } from "@/theme";

const HOURS = 24;
const AXIS_MARKS = [0, 6, 12, 18];
const CARD_H = 56;
const PAD = 6;

/** Long enough to read as a burn rather than a wipe, short enough not to be a wait. */
const BURN_MS = 620;
const STAGGER_MS = 90;

export type Day = {
  date: string;
  weekday: string;
  dayLabel: string;
  windows: Window[];
  best: Window | null;
  summary: {
    temp_min_c: number;
    temp_max_c: number;
    weather_code: number;
    precip_prob_max_pct: number;
  };
  today: boolean;
  hours: ScoredHour[];
  openHours: number;
  windMax: number;
};

export function DayCard({
  day,
  index,
  onPress,
}: {
  day: Day;
  index: number;
  onPress: () => void;
}) {
  // The only thing severity changes now is the temperature's colour. It used to have its
  // own line of text, which said in words what the burn says in its absence.
  const severe = isSevere(day.summary.weather_code);
  const [width, setWidth] = useState(0);

  // 0 → 1 as the day burns itself onto the card.
  const burnt = useSharedValue(0);
  useEffect(() => {
    burnt.set(
      withDelay(
        index * STAGGER_MS,
        withTiming(1, {
          duration: BURN_MS,
          easing: EASE_OUT,
          // Reduced motion gets the finished card immediately. The scorch is the state,
          // not the story — arriving without the animation loses nothing factual.
          reduceMotion: ReduceMotion.System,
        }),
      ),
    );
  }, [burnt, index]);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setWidth((current) => (current === measured ? current : measured));
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        day.today && styles.today,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={[
        day.weekday,
        day.dayLabel,
        `${Math.round(day.summary.temp_max_c)} dereceye kadar`,
        conditionLabel(day.summary.weather_code),
        day.best
          ? `${day.openHours} saat uygun, en iyisi ${formatWindowSpan(day.best)}`
          : "uygun saat yok",
      ].join(", ")}
    >
      <View style={styles.head}>
        <Text style={[styles.weekday, day.today && styles.weekdayToday]}>
          {day.weekday}
        </Text>
        <Text style={styles.date}>{day.dayLabel}</Text>
        <Text style={[styles.temp, severe && styles.severe]}>
          {Math.round(day.summary.temp_max_c)}°
          <Text style={styles.low}> {Math.round(day.summary.temp_min_c)}°</Text>
        </Text>
      </View>

      <View style={styles.cardStock} onLayout={onLayout}>
        {width > 0 ? <Recorder day={day} width={width} burnt={burnt} /> : null}
      </View>

      {day.best ? (
        <View style={styles.foot}>
          <Text style={styles.span}>{formatWindowSpan(day.best)}</Text>
          <Text style={styles.open}>{day.openHours} saat</Text>
        </View>
      ) : (
        <Text style={styles.none}>Uygun saat yok</Text>
      )}
    </Pressable>
  );
}

/**
 * The scorch itself.
 *
 * Two paths over a ruled card: the day's comfort curve, faint, drawn the whole way; and
 * the burn, which exists only where hours clear the profile. A blurred copy underneath is
 * the bloom — heat spreading into the stock around the mark it made.
 *
 * The reveal is a clip that grows across the canvas rather than a per-hour animation. It
 * is one shared value on the UI runtime, so the stagger costs nothing on the JS thread
 * while seven of them run at once.
 */
function Recorder({
  day,
  width,
  burnt,
}: {
  day: Day;
  width: number;
  burnt: { get: () => number };
}) {
  const height = CARD_H;

  const { curve, burns, rules } = useMemo(
    () => buildPaths(day, width, height),
    [day, width, height],
  );

  const reveal = useAnimatedStyle(() => ({ width: width * burnt.get() }));

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* The card is printed before anything is burnt onto it, so the ruling does not
          animate — only the scorch does. */}
      <Canvas style={{ width, height }}>
        <Path path={rules} color={colors.ruleSoft} style="stroke" strokeWidth={1} />
        <Path path={curve} color={colors.rule} style="stroke" strokeWidth={1.5} />
      </Canvas>

      <Animated.View style={[StyleSheet.absoluteFill, reveal, styles.clip]}>
        <Canvas style={{ width, height }}>
          <Group>
            <Blur blur={5} />
            <Path path={burns} color={colors.burn} style="stroke" strokeWidth={7} />
          </Group>
          <Path path={burns} color={colors.burnHi} style="stroke" strokeWidth={2} />
        </Canvas>
      </Animated.View>
    </View>
  );
}

function buildPaths(day: Day, width: number, height: number) {
  const top = PAD;
  const bottom = height - PAD * 2;
  const step = width / (HOURS - 1);
  const x = (hour: number) => hour * step;
  const y = (score: number) => bottom - (score / 100) * (bottom - top);

  const curve = Skia.Path.Make();
  day.hours.forEach((hour, i) => {
    if (i === 0) curve.moveTo(x(i), y(hour.score));
    else curve.lineTo(x(i), y(hour.score));
  });

  // The burn follows the same curve, but only across the hours that clear the profile —
  // so its height carries the score and its extent carries the window. One mark, two
  // readings, which is what the trace does at full size.
  const burns = Skia.Path.Make();
  for (const window of day.windows) {
    for (let hour = window.start_hour; hour <= window.end_hour; hour += 1) {
      const scored = day.hours[hour];
      if (scored === undefined) continue;
      if (hour === window.start_hour) burns.moveTo(x(hour), y(scored.score));
      else burns.lineTo(x(hour), y(scored.score));
    }
  }

  const rules: SkPath = Skia.Path.Make();
  for (const hour of AXIS_MARKS) {
    rules.moveTo(x(hour), top);
    rules.lineTo(x(hour), bottom);
  }
  rules.moveTo(0, bottom);
  rules.lineTo(width, bottom);

  return { curve, burns, rules };
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: space.sm,
    overflow: "hidden",
  },
  today: { borderColor: colors.burn, backgroundColor: colors.ground2 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },

  head: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  // A week is scanned by day name, so the day name is the largest thing on the card and
  // everything else defers to it.
  weekday: { ...type.display, fontSize: 18, color: colors.ink },
  weekdayToday: { color: colors.burnHi },
  date: { ...type.data, fontSize: 10, color: colors.inkDim, flex: 1 },
  temp: { ...type.data, fontSize: 20, color: colors.ink },
  low: { ...type.data, fontSize: 13, color: colors.inkDim },
  severe: { color: colors.ember },

  cardStock: { height: CARD_H },
  clip: { overflow: "hidden" },

  foot: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  span: { ...type.data, fontSize: 13, color: colors.burnHi, flex: 1 },
  open: { ...type.body, fontSize: 12, color: colors.inkDim },
  none: { ...type.body, fontSize: 12, color: colors.inkDim },
});
