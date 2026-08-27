/**
 * İz — the main screen, and the planner's output.
 *
 * Top to bottom: the verdict (a span of time, not a temperature), the trace, the time
 * span control, the activity chips, and the ranked windows. docs/11 has the reasoning
 * for the order and for what each control is not.
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

import { Trace } from "@/components/trace";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  CONSTRAINT_LABELS,
  bestHourIndex,
  formatAge,
  formatWindowDay,
  formatWindowSpan,
  getPlan,
  sliceFor,
  SPAN_LABELS,
  type ActivityKey,
  type Span,
} from "@/lib/plan";
import { colors, radius, size, space, type } from "@/theme";

const GUTTER = space.lg;

export function TraceScreen() {
  const { width } = useWindowDimensions();
  const [activity, setActivity] = useState<ActivityKey>("running");
  const [span, setSpan] = useState<Span>("day");

  const plan = getPlan(activity);
  const slice = useMemo(() => sliceFor(plan, span), [plan, span]);
  const startAt = useMemo(() => bestHourIndex(plan, slice), [plan, slice]);
  const best = plan.windows[0];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.place}>İstanbul</Text>
          <Text style={styles.age}>
            {plan.stale ? "bayat · " : ""}
            {formatAge(plan.fetched_at)}
          </Text>
        </View>

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

        {/* Full-bleed: the trace is the spine, so it runs edge to edge. */}
        <View style={styles.bleed}>
          {/* Remounting on span or activity change resets the scrubber to the new
              best window, which is what the change was asking for. */}
          <Trace
            key={`${activity}-${span}`}
            slice={slice}
            width={width}
            initialIndex={startAt}
          />
        </View>

        <View style={styles.controls}>
          <Segmented value={span} onChange={setSpan} />
        </View>

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

        <View style={styles.list}>
          <Text style={styles.listHead}>Bu hafta</Text>
          {plan.windows.slice(0, 6).map((w) => (
            <View key={`${w.day}-${w.start_hour}`} style={styles.row}>
              <Text style={styles.rowDay}>{formatWindowDay(w).slice(0, 3)}</Text>
              <Text style={styles.rowSpan}>{formatWindowSpan(w)}</Text>
              <Bars score={w.score} />
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
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

function Segmented({ value, onChange }: { value: Span; onChange: (s: Span) => void }) {
  return (
    <View style={styles.segment}>
      {(Object.keys(SPAN_LABELS) as Span[]).map((key) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          hitSlop={8}
          style={[styles.segmentItem, key === value && styles.segmentItemOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: key === value }}
        >
          <Text style={[styles.segmentText, key === value && styles.segmentTextOn]}>
            {SPAN_LABELS[key]}
          </Text>
        </Pressable>
      ))}
    </View>
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

/** Four marks, filled by score. A number would be precision the score does not have. */
function Bars({ score }: { score: number }) {
  const filled = Math.max(1, Math.round((score / 100) * 4));
  return (
    <View style={styles.bars}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.bar, i < filled && styles.barOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ground },
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

  verdict: { paddingHorizontal: GUTTER, paddingTop: space.xl, gap: 2 },
  day: { ...type.display, fontSize: size.verdict, color: colors.ink, letterSpacing: 0.5 },
  span: { ...type.data, fontSize: size.span, color: colors.burnHi },
  why: { ...type.body, fontSize: size.caption, color: colors.inkDim, marginTop: space.sm },
  emptyHead: { ...type.heading, fontSize: size.title, color: colors.ink, lineHeight: 24 },

  bleed: { marginTop: space.xl },

  controls: { paddingHorizontal: GUTTER, marginTop: space.md, alignItems: "flex-start" },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: colors.rule },
  segmentItem: { paddingVertical: 6, paddingHorizontal: space.md },
  segmentItemOn: { backgroundColor: colors.burnWash },
  segmentText: { ...type.label, color: colors.inkDim },
  segmentTextOn: { color: colors.burnHi },

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

  list: { marginTop: space.xxl, paddingHorizontal: GUTTER },
  listHead: {
    ...type.label,
    color: colors.inkDim,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  rowDay: { ...type.data, fontSize: size.caption, color: colors.inkDim, width: 34 },
  rowSpan: { ...type.data, fontSize: size.caption, color: colors.ink, flex: 1 },

  bars: { flexDirection: "row", gap: 2 },
  bar: { width: 5, height: 11, backgroundColor: colors.rule },
  barOn: { backgroundColor: colors.burn },
});
