/**
 * The week, as seven cards.
 *
 * The first attempt drew all 168 hours as one continuous trace — on a phone that is about
 * two pixels an hour, which is technically the same information and practically a smear.
 * The second was a compact grid: one row per day on a shared 24-hour axis, good for
 * spotting that mornings are open all week and poor at answering "what is Thursday like".
 *
 * A card answers that. Each one carries the day's own summary — its temperatures, its
 * condition, its windows on their own axis, and the best of them called out — so a day can
 * be read on its own rather than only in comparison with the six around it. The shared
 * axis survives inside the cards, which is what keeps the comparison possible: every card
 * plots the same 00–24 across the same width, so open bands still line up down the screen.
 *
 * Plain views rather than Skia. This is a handful of rectangles positioned by percentage,
 * and reaching for a canvas to draw them would be the wrong tool — the trace earns a canvas
 * because it is a continuous curve; this does not.
 */

import Animated from "react-native-reanimated";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { arrive } from "@/lib/motion";
import {
  formatWindowSpan,
  type DaySummary,
  type PlanResult,
  type ScoredHour,
  type Window,
} from "@/lib/plan";
import { conditionLabel, isSevere } from "@/lib/weather-code";
import { colors, radius, size, space, type } from "@/theme";

const HOURS = 24;
const AXIS_MARKS = [0, 6, 12, 18];
const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/**
 * How long each card waits before arriving.
 *
 * A stagger, not a cascade. Sixty milliseconds apart reads as one movement with depth;
 * much more and the last card is late enough that a person notices they are waiting for
 * a list they can already see.
 */
const STAGGER_MS = 60;

type Day = {
  date: string;
  weekday: string;
  dayLabel: string;
  windows: Window[];
  best: Window | null;
  summary: DaySummary;
  today: boolean;
  /** The day's 24 scored hours, in order. Empty when the forecast does not reach it. */
  hours: ScoredHour[];
  /** How many hours clear the profile — the number a planner actually scans for. */
  openHours: number;
  /** The day's strongest wind, which is usually the reason a window closed. */
  windMax: number;
};

/**
 * Days come from the server's own grouping.
 *
 * The client never re-derives where a day starts from UTC — if it did, the cards and the
 * trace would disagree about which window belongs to which day, twice a year at least.
 */
function groupByDay(plan: PlanResult): Day[] {
  const byDate = new Map<string, Window[]>();
  for (const window of plan.windows ?? []) {
    const list = byDate.get(window.day) ?? [];
    list.push(window);
    byDate.set(window.day, list);
  }

  return plan.days.map((summary, index) => {
    const windows = (byDate.get(summary.date) ?? []).sort(
      (a, b) => a.start_hour - b.start_hour,
    );
    const [year, month, day] = summary.date.split("-").map(Number);
    const when = new Date(Date.UTC(year, month - 1, day));

    // The server returns hours in 24-hour blocks aligned with the days it reports, which
    // is the same assumption the trace slices on. Grouping by timestamp here instead would
    // be the client re-deriving a day boundary — the thing this function exists not to do.
    const hours = plan.hours.slice(index * HOURS, (index + 1) * HOURS);

    return {
      hours,
      openHours: windows.reduce((n, w) => n + (w.end_hour - w.start_hour + 1), 0),
      windMax: hours.reduce((top, hour) => Math.max(top, hour.wind_kmh), 0),
      date: summary.date,
      weekday: index === 0 ? "Bugün" : WEEKDAYS[when.getUTCDay()],
      dayLabel: `${day} ${MONTHS[month - 1]}`,
      windows,
      summary,
      today: index === 0,
      best: windows.reduce<Window | null>(
        (top, w) => (top === null || w.score > top.score ? w : top),
        null,
      ),
    };
  });
}

export function Calendar({
  plan,
  onSelectDay,
}: {
  plan: PlanResult;
  onSelectDay: (dayIndex: number) => void;
}) {
  const days = groupByDay(plan);

  // One temperature scale for the week, so the bars compare days rather than each
  // redrawing itself full-width. A day-local scale would make every day look the same.
  const range = {
    min: Math.min(...days.map((d) => d.summary.temp_min_c)),
    max: Math.max(...days.map((d) => d.summary.temp_max_c)),
  };

  return (
    <View style={styles.stack}>
      {days.map((day, index) => (
        <Animated.View key={day.date} entering={arrive().delay(index * STAGGER_MS)}>
          <DayCard day={day} range={range} onPress={() => onSelectDay(index)} />
        </Animated.View>
      ))}
    </View>
  );
}

function DayCard({
  day,
  range,
  onPress,
}: {
  day: Day;
  range: { min: number; max: number };
  onPress: () => void;
}) {
  const severe = isSevere(day.summary.weather_code);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        day.today && styles.cardToday,
        // Press feedback on press-in rather than on commit: waiting for the tap to
        // complete before showing anything is the latency a person actually perceives.
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={[
        day.weekday,
        day.dayLabel,
        `en yüksek ${Math.round(day.summary.temp_max_c)} derece`,
        conditionLabel(day.summary.weather_code),
        day.best ? `en iyi pencere ${formatWindowSpan(day.best)}` : "uygun pencere yok",
      ].join(", ")}
    >
      <View style={styles.head}>
        <Text style={[styles.weekday, day.today && styles.weekdayToday]}>
          {day.weekday}
        </Text>
        <Text style={styles.date}>{day.dayLabel}</Text>
      </View>

      <View style={styles.conditions}>
        <Text style={styles.high}>{Math.round(day.summary.temp_max_c)}°</Text>
        <Text style={styles.low}>{Math.round(day.summary.temp_min_c)}°</Text>
        <Text style={[styles.condition, severe && styles.severe]} numberOfLines={1}>
          {conditionLabel(day.summary.weather_code)}
        </Text>
        {day.summary.precip_prob_max_pct > 0 ? (
          <Text style={styles.rain}>%{day.summary.precip_prob_max_pct}</Text>
        ) : null}
        {/* Wind earns its place: it is the limit that closes windows most often, and a
            day with none looks identical to a gale without it. */}
        {day.windMax >= 15 ? (
          <Text style={styles.wind}>{Math.round(day.windMax)} km/sa</Text>
        ) : null}
      </View>

      <TempBar day={day} range={range} />

      <Comb hours={day.hours} windows={day.windows} />

      <View style={styles.footer}>
        {day.best ? (
          <>
            <Text style={styles.bestLabel}>En iyi</Text>
            <Text style={styles.bestSpan}>{formatWindowSpan(day.best)}</Text>
            <Text style={styles.openHours}>{day.openHours} saat uygun</Text>
            <Text style={styles.bestScore}>{Math.round(day.best.score)}</Text>
          </>
        ) : (
          <Text style={styles.none}>Sınırlarını geçen saat yok</Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The day's temperature, on the week's scale.
 *
 * Every bar is drawn against the same minimum and maximum, so a short bar sitting high up
 * means a mild day and a long one low down means a cold morning and a warm afternoon. A
 * per-day scale would fill every card the same way and compare nothing, which is the whole
 * reason to draw it rather than print two numbers a second time.
 */
function TempBar({ day, range }: { day: Day; range: { min: number; max: number } }) {
  const span = Math.max(1, range.max - range.min);
  const left = ((day.summary.temp_min_c - range.min) / span) * 100;
  const width = ((day.summary.temp_max_c - day.summary.temp_min_c) / span) * 100;

  return (
    <View style={styles.tempTrack}>
      <View style={[styles.tempFill, { left: `${left}%`, width: `${Math.max(width, 2)}%` }]} />
    </View>
  );
}

/**
 * The day, hour by hour: the trace at week scale.
 *
 * Twenty-four bars whose height is the comfort score, amber where the hour clears the
 * profile and dim where it does not. It replaces a plain band because it carries the same
 * shape the İz screen draws — a card and the trace are then two sizes of one instrument
 * rather than two unrelated pictures, and *why* a window ends is visible instead of merely
 * where.
 *
 * Views rather than a canvas: twenty-four rectangles is not a curve, and seven small Skia
 * surfaces on a scrolling screen would cost more than they are worth.
 */
function Comb({ hours, windows }: { hours: ScoredHour[]; windows: Window[] }) {
  const open = new Set<number>();
  for (const window of windows) {
    for (let h = window.start_hour; h <= window.end_hour; h += 1) open.add(h);
  }

  return (
    <View style={styles.track}>
      <View style={styles.comb}>
        {Array.from({ length: HOURS }, (_, hour) => {
          const scored = hours[hour];
          // A missing hour draws nothing rather than a zero: the forecast not reaching a
          // day is a different statement from that day scoring badly.
          const score = scored ? scored.score : null;
          const lit = open.has(hour);

          return (
            <View key={hour} style={styles.slot}>
              {score === null ? null : (
                <View
                  style={[
                    styles.bar,
                    lit ? styles.barOpen : styles.barShut,
                    // A floor so a bad hour is still a mark. A bar of zero height reads as
                    // missing data, and missing and bad are not the same news.
                    { height: `${Math.max(6, score)}%` },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>

      {AXIS_MARKS.map((hour) => (
        <Text
          key={`label-${hour}`}
          style={[styles.axisLabel, { left: `${(hour / HOURS) * 100}%` }]}
        >
          {String(hour).padStart(2, "0")}
        </Text>
      ))}
    </View>
  );
}

const TRACK_HEIGHT = 44;
const COMB_HEIGHT = 30;

const styles = StyleSheet.create({
  stack: { gap: space.sm, paddingHorizontal: space.lg },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: space.sm,
  },
  cardToday: { borderLeftWidth: 2, borderLeftColor: colors.burn },
  cardPressed: { backgroundColor: colors.ground2, transform: [{ scale: 0.985 }] },

  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  weekday: { ...type.display, fontSize: size.body, color: colors.ink },
  weekdayToday: { color: colors.burnHi },
  date: { ...type.data, fontSize: 11, color: colors.inkDim },

  conditions: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  high: { ...type.data, fontSize: 22, color: colors.ink },
  low: { ...type.data, fontSize: size.caption, color: colors.inkDim },
  condition: { ...type.body, fontSize: size.caption, color: colors.ink2, flex: 1 },
  severe: { color: colors.ember },
  rain: { ...type.data, fontSize: 11, color: colors.glacial },
  wind: { ...type.data, fontSize: 11, color: colors.inkDim },

  tempTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.ruleSoft,
  },
  tempFill: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.glacial,
  },

  track: {
    height: TRACK_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleSoft,
    paddingTop: space.xs,
  },
  comb: { height: COMB_HEIGHT, flexDirection: "row", alignItems: "flex-end" },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end", paddingHorizontal: 0.5 },
  bar: { width: "100%", borderRadius: 1 },
  barOpen: { backgroundColor: colors.burn },
  barShut: { backgroundColor: colors.rule },
  axisLabel: {
    position: "absolute",
    bottom: 0,
    ...type.data,
    fontSize: 9,
    color: colors.inkDim,
  },

  footer: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  bestLabel: { ...type.label, color: colors.inkDim },
  bestSpan: { ...type.data, fontSize: size.caption, color: colors.burnHi },
  openHours: { ...type.body, fontSize: 11, color: colors.inkDim, flex: 1 },
  bestScore: { ...type.data, fontSize: size.caption, color: colors.ink2 },
  none: { ...type.body, fontSize: 12, color: colors.inkDim },
});
