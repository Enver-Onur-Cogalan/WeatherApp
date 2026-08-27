/**
 * İz — the main screen, and the planner's output.
 *
 * The verdict is a span of hours rather than a temperature, because that is what the
 * scoring engine produces (docs/10). Below it, two views that answer different
 * questions rather than the same one at two zoom levels:
 *
 *   24 saat — the shape of one day, scrubbable hour by hour
 *   7 gün   — which days have windows, and where in the day they fall
 *
 * The week is not a longer day. Drawing 168 hours as one trace was legible in a mockup
 * and a smear on a phone, so the week gets a grid of days instead.
 */

import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Atmosphere } from "@/components/atmosphere";
import { Now } from "@/components/now";
import { Trace } from "@/components/trace";
import { Week } from "@/components/week";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  CONSTRAINT_LABELS,
  bestHourIndex,
  currentDayIndex,
  currentHour,
  dayLabels,
  formatAge,
  formatWindowDay,
  formatWindowSpan,
  getPlan,
  sliceFor,
  type ActivityKey,
  type Span,
} from "@/lib/plan";
import { colors, radius, size, space, type } from "@/theme";

const GUTTER = space.lg;

export function TraceScreen() {
  const { width } = useWindowDimensions();
  const [activity, setActivity] = useState<ActivityKey>("running");
  const [span, setSpan] = useState<Span>("day");
  const [day, setDay] = useState<number | null>(null);
  const [scrubbed, setScrubbed] = useState<number | null>(null);

  const plan = getPlan(activity);
  // Opens on the day the person is actually in, not on the first day of the forecast.
  const today = currentDayIndex(plan);
  const selectedDay = day ?? today;
  const days = useMemo(() => dayLabels(plan), [plan]);
  const slice = useMemo(() => sliceFor(plan, "day", selectedDay), [plan, selectedDay]);
  const startAt = useMemo(
    () => bestHourIndex(plan, slice, selectedDay),
    [plan, slice, selectedDay],
  );
  const best = plan.windows[0];
  const now = currentHour(plan);

  const showDay = (index: number) => {
    setDay(index);
    setScrubbed(null);
    setSpan("day");
  };

  // The sky reflects whichever hour is on screen, so scrubbing changes the weather
  // behind the trace as well as the numbers in front of it (ADR-0013).
  const atmosphereHour =
    (span === "day" && scrubbed !== null ? slice.hours[scrubbed] : null) ??
    now ??
    plan.hours[0];

  return (
    <View style={styles.safe}>
      <Atmosphere
        localHour={atmosphereHour.local_hour}
        weatherCode={atmosphereHour.weather_code}
        precipProbPct={atmosphereHour.precip_prob_pct}
        windKmh={atmosphereHour.wind_kmh}
        cloudCoverPct={atmosphereHour.cloud_cover_pct}
      />
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.place}>İstanbul</Text>
          <Text style={styles.age}>
            {plan.stale ? "bayat · " : ""}
            {formatAge(plan.fetched_at)}
          </Text>
        </View>

        <Now hour={now} today={plan.days[today] ?? null} />

        {best ? (
          <View style={styles.verdict}>
            <Text style={styles.day}>{formatWindowDay(best)}</Text>
            <Text style={styles.span}>{formatWindowSpan(best)}</Text>
            <Text style={styles.why}>
              {ACTIVITY_LABELS[activity]} için haftanın en iyi penceresi.
            </Text>
          </View>
        ) : (
          <Empty blocker={plan.blocker} activity={activity} />
        )}

        <View style={styles.chips}>
          {ACTIVITIES.map((key) => (
            <Chip
              key={key}
              label={ACTIVITY_LABELS[key]}
              active={key === activity}
              onPress={() => setActivity(key)}
            />
          ))}
        </View>

        <View style={styles.tabs}>
          <Tab label="24 saat" active={span === "day"} onPress={() => setSpan("day")} />
          <Tab label="7 gün" active={span === "week"} onPress={() => setSpan("week")} />
        </View>

        {span === "day" ? (
          <View style={styles.dayView}>
            <View style={styles.dayStrip}>
              {days.map((label, index) => (
                <Pressable
                  key={label + index}
                  onPress={() => {
                    setDay(index);
                    setScrubbed(null);
                  }}
                  hitSlop={6}
                  style={[styles.dayPill, index === selectedDay && styles.dayPillOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: index === selectedDay }}
                >
                  <Text style={[styles.dayPillText, index === selectedDay && styles.dayPillTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Full-bleed: the trace is the spine, so it runs edge to edge. */}
            {/* Remounting per day and activity resets the scrubber to that slice's best
                hour, which is what changing either was asking for. */}
            <Trace
              key={`${activity}-${selectedDay}`}
              slice={slice}
              width={width}
              initialIndex={startAt}
              nowIndex={
                selectedDay === today && plan.now_index !== null
                  ? plan.now_index - today * 24
                  : null
              }
              onScrub={setScrubbed}
            />

            <Text style={styles.legend}>
              Çizgi ne kadar yüksekse o saat {ACTIVITY_LABELS[activity].toLowerCase()} için
              o kadar uygun. Kehribar bölümler sınırlarını geçen pencereler.
            </Text>
          </View>
        ) : (
          <View style={styles.weekView}>
            <Week plan={plan} onSelectDay={showDay} />
            <Text style={styles.legend}>
              Her satır bir gün, aynı 24 saatlik eksende. Bir güne dokun, o günün izini aç.
            </Text>
          </View>
        )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Empty({
  blocker,
  activity,
}: {
  blocker: { constraint: string; hours: number } | null;
  activity: ActivityKey;
}) {
  return (
    <View style={styles.verdict}>
      <Text style={styles.emptyHead}>Bu hafta hiçbir saat sınırlarını geçmiyor</Text>
      {blocker ? (
        <Text style={styles.why}>
          {CONSTRAINT_LABELS[blocker.constraint] ?? blocker.constraint} limitin tek başına{" "}
          {blocker.hours} saati eledi.
        </Text>
      ) : (
        <Text style={styles.why}>{ACTIVITY_LABELS[activity]} profilin için sonuç yok.</Text>
      )}
    </View>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.tab, active && styles.tabOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[styles.chip, active && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ground },
  // Transparent, so the atmosphere behind it shows through the upper part of the screen.
  fill: { flex: 1 },
  scroll: { paddingBottom: space.xxl },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: GUTTER,
    paddingTop: space.sm,
  },
  place: { ...type.heading, fontSize: size.caption, color: colors.ink, letterSpacing: 0.6 },
  age: { ...type.data, fontSize: size.caption, color: colors.inkDim },

  verdict: { paddingHorizontal: GUTTER, paddingTop: space.lg, gap: 2 },
  day: { ...type.display, fontSize: size.verdict, color: colors.ink, letterSpacing: 0.5 },
  span: { ...type.data, fontSize: size.span, color: colors.burnHi },
  why: { ...type.body, fontSize: size.caption, color: colors.inkDim, marginTop: space.sm },
  emptyHead: { ...type.heading, fontSize: size.title, color: colors.ink, lineHeight: 24 },

  chips: { flexDirection: "row", gap: space.sm, paddingHorizontal: GUTTER, marginTop: space.lg },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  chipOn: { borderColor: colors.burn, backgroundColor: colors.burnWash },
  chipText: { ...type.body, fontSize: size.caption, color: colors.inkDim },
  chipTextOn: { color: colors.burnHi },

  tabs: {
    flexDirection: "row",
    marginTop: space.xl,
    marginHorizontal: GUTTER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  tab: { paddingVertical: space.sm, paddingRight: space.xl, marginBottom: -1 },
  tabOn: { borderBottomWidth: 2, borderColor: colors.burn },
  tabText: { ...type.label, color: colors.inkDim },
  tabTextOn: { color: colors.ink },

  dayView: { marginTop: space.lg },
  dayStrip: {
    flexDirection: "row",
    gap: space.xs,
    paddingHorizontal: GUTTER,
    marginBottom: space.lg,
  },
  dayPill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm },
  dayPillOn: { backgroundColor: colors.surface },
  dayPillText: { ...type.data, fontSize: 11, color: colors.inkDim },
  dayPillTextOn: { color: colors.ink },

  weekView: { marginTop: space.xl },

  legend: {
    ...type.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.inkDim,
    paddingHorizontal: GUTTER,
    marginTop: space.md,
  },
});
