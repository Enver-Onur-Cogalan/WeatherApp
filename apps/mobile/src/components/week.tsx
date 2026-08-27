/**
 * The week, as seven days of hours.
 *
 * The first attempt drew all 168 hours as one continuous trace. On a phone that is
 * roughly two pixels an hour — technically the same information, practically a smear.
 * A week is not a longer day, so it does not get the same drawing.
 *
 * Each row is one day across the same 24-hour axis, with the open windows burned into
 * it. Days line up vertically, so "mornings are good all week" is a shape you see rather
 * than a sentence you read.
 *
 * Plain views rather than Skia: this is a handful of rectangles positioned by
 * percentage, and reaching for a canvas to draw them would be the wrong tool.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatWindowSpan, type PlanResult, type Window } from "@/lib/plan";
import { colors, size, space, type } from "@/theme";

const HOURS = 24;
const AXIS_MARKS = [0, 6, 12, 18];
const WEEKDAYS_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

type Day = {
  date: string;
  label: string;
  windows: Window[];
  best: Window | null;
};

function groupByDay(plan: PlanResult): Day[] {
  const order: string[] = [];
  const byDate = new Map<string, Window[]>();

  for (const hour of plan.hours) {
    const date = hour.hour_utc.slice(0, 10);
    if (!byDate.has(date)) {
      byDate.set(date, []);
      order.push(date);
    }
  }
  for (const window of plan.windows) {
    byDate.get(window.day)?.push(window);
  }

  return order.map((date) => {
    const windows = (byDate.get(date) ?? []).sort((a, b) => a.start_hour - b.start_hour);
    const [year, month, day] = date.split("-").map(Number);
    return {
      date,
      label: WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
      windows,
      best: windows.reduce<Window | null>(
        (top, w) => (top === null || w.score > top.score ? w : top),
        null,
      ),
    };
  });
}

export function Week({
  plan,
  onSelectDay,
}: {
  plan: PlanResult;
  onSelectDay: (dayIndex: number) => void;
}) {
  const days = groupByDay(plan);

  return (
    <View style={styles.wrap}>
      <View style={styles.axis}>
        <View style={styles.gutter} />
        <View style={styles.axisTrack}>
          {AXIS_MARKS.map((hour) => (
            <Text
              key={hour}
              style={[styles.axisLabel, { left: `${(hour / HOURS) * 100}%` }]}
            >
              {String(hour).padStart(2, "0")}
            </Text>
          ))}
        </View>
      </View>

      {days.map((day, dayIndex) => (
        <Pressable
          key={day.date}
          onPress={() => onSelectDay(dayIndex)}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={
            day.best
              ? `${day.label}, en iyi pencere ${formatWindowSpan(day.best)}`
              : `${day.label}, pencere yok`
          }
        >
          <Text style={styles.day}>{day.label}</Text>

          <View style={styles.track}>
            {AXIS_MARKS.map((hour) => (
              <View
                key={hour}
                style={[
                  styles.tick,
                  { left: `${(hour / HOURS) * 100}%` },
                  hour === 0 && styles.tickMajor,
                ]}
              />
            ))}

            {day.windows.map((w) => (
              <View
                key={`${w.day}-${w.start_hour}`}
                style={[
                  styles.burn,
                  {
                    left: `${(w.start_hour / HOURS) * 100}%`,
                    // +1 so a window ending at 11:00 covers the 11th hour rather than
                    // stopping at its start, which would read an hour short.
                    width: `${((w.end_hour - w.start_hour + 1) / HOURS) * 100}%`,
                    opacity: 0.35 + (w.score / 100) * 0.65,
                  },
                ]}
              />
            ))}
          </View>

          <Text style={styles.best}>
            {day.best ? formatWindowSpan(day.best) : "—"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const GUTTER = 34;
const BEST = 92;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg },

  axis: { flexDirection: "row", alignItems: "center", paddingBottom: space.xs },
  gutter: { width: GUTTER },
  axisTrack: { flex: 1, height: 12, marginRight: BEST },
  axisLabel: {
    ...type.label,
    fontSize: 9,
    color: colors.inkDim,
    position: "absolute",
    marginLeft: -6,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  day: { ...type.data, fontSize: size.caption, color: colors.inkDim, width: GUTTER },

  track: {
    flex: 1,
    height: 16,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  tick: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: colors.ruleSoft },
  tickMajor: { backgroundColor: colors.rule },
  burn: { position: "absolute", top: 0, bottom: 0, backgroundColor: colors.burn },

  best: {
    ...type.data,
    fontSize: size.caption,
    color: colors.ink,
    width: BEST,
    textAlign: "right",
  },
});
