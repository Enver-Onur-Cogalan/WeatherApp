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
import { formatWindowSpan, type DaySummary, type PlanResult, type Window } from "@/lib/plan";
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

    return {
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

  return (
    <View style={styles.stack}>
      {days.map((day, index) => (
        <Animated.View key={day.date} entering={arrive().delay(index * STAGGER_MS)}>
          <DayCard day={day} onPress={() => onSelectDay(index)} />
        </Animated.View>
      ))}
    </View>
  );
}

function DayCard({ day, onPress }: { day: Day; onPress: () => void }) {
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
      </View>

      <Windows windows={day.windows} />

      <View style={styles.footer}>
        {day.best ? (
          <>
            <Text style={styles.bestLabel}>En iyi</Text>
            <Text style={styles.bestSpan}>{formatWindowSpan(day.best)}</Text>
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
 * The day's open windows on a 24-hour track.
 *
 * The same axis in every card, so a band at 06:00 sits at the same x on Monday as on
 * Friday and the week is still readable as a column — the one thing the grid was good at.
 */
function Windows({ windows }: { windows: Window[] }) {
  return (
    <View style={styles.track}>
      {AXIS_MARKS.map((hour) => (
        <View key={hour} style={[styles.tick, { left: `${(hour / HOURS) * 100}%` }]} />
      ))}

      {windows.map((window) => (
        <View
          key={`${window.start_hour}-${window.end_hour}`}
          style={[
            styles.burn,
            {
              left: `${(window.start_hour / HOURS) * 100}%`,
              // `end_hour` is inclusive, so the band covers the hour it names rather than
              // stopping at its start.
              width: `${((window.end_hour - window.start_hour + 1) / HOURS) * 100}%`,
              // Score as opacity: a 95 window should look more open than a 76, and the
              // floor keeps a weak one visible rather than implying it does not exist.
              opacity: 0.35 + (window.score / 100) * 0.65,
            },
          ]}
        />
      ))}

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

const TRACK_HEIGHT = 26;

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

  track: {
    height: TRACK_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleSoft,
    paddingTop: space.xs,
  },
  tick: {
    position: "absolute",
    top: space.xs,
    width: StyleSheet.hairlineWidth,
    height: 8,
    backgroundColor: colors.rule,
  },
  burn: {
    position: "absolute",
    top: space.xs,
    height: 8,
    backgroundColor: colors.burn,
    borderRadius: 1,
  },
  axisLabel: {
    position: "absolute",
    bottom: 0,
    ...type.data,
    fontSize: 9,
    color: colors.inkDim,
  },

  footer: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  bestLabel: { ...type.label, color: colors.inkDim },
  bestSpan: { ...type.data, fontSize: size.caption, color: colors.burnHi, flex: 1 },
  bestScore: { ...type.data, fontSize: size.caption, color: colors.ink2 },
  none: { ...type.body, fontSize: 12, color: colors.inkDim },
});
