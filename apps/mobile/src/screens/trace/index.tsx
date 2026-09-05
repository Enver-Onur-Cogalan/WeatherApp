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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Atmosphere } from "@/components/atmosphere";
import { Calendar } from "@/components/calendar";
import { Places } from "@/components/places";
import { Now } from "@/components/now";
import { Legible, quantiseScroll, SkyProvider, useInk } from "@/components/legible";
import { Failure, Loading } from "@/components/states";
import { Trace } from "@/components/trace";
import { arrive, leave } from "@/lib/motion";
import {
  CONSTRAINT_LABELS,
  bestHourIndex,
  currentDayIndex,
  currentHour,
  dayLabels,
  formatAge,
  formatWindowDay,
  formatWindowSpan,
  sliceFor,
  type PlanResult,
  type Span,
  type Window,
} from "@/lib/plan";
import { useSelectedLocation } from "@/lib/locations";
import { useChoices, type Choice } from "@/lib/profiles";
import { usePlan } from "@/lib/queries";
import { colors, radius, size, space, type } from "@/theme";

const GUTTER = space.lg;

export function TraceScreen() {
  const { choices } = useChoices();
  const [chosen, setChosen] = useState<string | null>(null);

  // Falls back to the first rather than holding a stale key: a profile can be deleted on
  // another device, and a chip pointing at nothing would leave the screen blank.
  const choice = choices.find((item) => item.key === chosen) ?? choices[0];
  const { selected } = useSelectedLocation();
  const { data: plan, error, isPending, refetch } = usePlan(choice, selected);

  // Three states, and the order matters. A device cache means `plan` can be present while
  // `error` is set — the server is unreachable and the last answer to this exact question
  // is on the phone (ADR-0016). That is the case worth getting right: the app opens and
  // draws, rather than showing a failure it has the data to avoid.
  if (isPending) {
    return (
      <Shell place={selected.label}>
        <Loading label="Tahmin alınıyor" />
      </Shell>
    );
  }

  if (plan === undefined) {
    return (
      <Shell place={selected.label}>
        <Failure error={error} onRetry={() => void refetch()} />
      </Shell>
    );
  }

  return (
    <Loaded
      plan={plan}
      choices={choices}
      choice={choice}
      place={selected}
      onChoose={setChosen}
      offline={error !== null}
      onRefresh={async () => {
        await refetch();
      }}
      key={/* a new plan is a new slice, and the scrubber should not survive it */ choice.key}
    />
  );
}

/** The header and background, with nothing to draw in them yet. */
function Shell({ place, children }: { place: string; children: React.ReactNode }) {
  return (
    <View style={styles.safe}>
      <SafeAreaView style={styles.fill} edges={["top"]}>
        <View style={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.place}>{place}</Text>
          </View>
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}

function Loaded({
  plan,
  choices,
  choice,
  place,
  onChoose,
  offline,
  onRefresh,
}: {
  plan: PlanResult;
  choices: Choice[];
  choice: Choice;
  place: { label: string };
  onChoose: (key: string) => void;
  /** The server could not be reached and this trace came off the device. */
  offline: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const [span, setSpan] = useState<Span>("day");
  const [day, setDay] = useState<number | null>(null);
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  /**
   * Pull to refresh.
   *
   * `refreshing` is its own state rather than the query's `isFetching`. A cached plan
   * older than the stale time refetches on its own at launch (ADR-0016), and binding the
   * control to that would spin the wheel at someone who never pulled anything — the
   * control should report *the gesture*, not every fetch.
   */
  const pull = async () => {
    setRefreshing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

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
        <SkyProvider
          value={{
            localHour: atmosphereHour.local_hour,
            cloudCoverPct: atmosphereHour.cloud_cover_pct,
            scrollY,
          }}
        >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={pull}
              // The platform default is a light spinner on a light tray, which is a hole
              // punched in a screen that commits to one dark world (docs/10).
              tintColor={colors.burnHi}
              colors={[colors.burnHi]}
              progressBackgroundColor={colors.surface}
            />
          }
          scrollEventThrottle={64}
          onScroll={(event) => {
            const next = quantiseScroll(event.nativeEvent.contentOffset.y);
            setScrollY((current) => (current === next ? current : next));
          }}
        >
        <Legible style={styles.header}>
          <Header place={place.label} plan={plan} onPress={() => setPicking(true)} />
        </Legible>

        {/* The banner's button and the pull do the same thing. Both earn their place: the
            pull is the habit, and the banner is what tells someone there is anything to
            refresh in the first place. */}
        {offline ? <Offline fetchedAt={plan.fetched_at} onRefresh={pull} /> : null}

        <Legible>
          <Now hour={now} today={plan.days[today] ?? null} />
        </Legible>

        <Legible>
          {best ? (
            <Verdict window={best} label={choice.label} />
          ) : (
            <Empty blocker={plan.blocker} label={choice.label} />
          )}
        </Legible>

        <View style={styles.chips}>
          {choices.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              active={item.key === choice.key}
              onPress={() => onChoose(item.key)}
            />
          ))}
        </View>

        {/* One switch, two readings of the same plan. The trace answers "when today",
            the calendar answers "which day" — different questions, so they get different
            drawings rather than the same one at two zoom levels. */}
        <View style={styles.tabs}>
          <Tab label="24 saat" active={span === "day"} onPress={() => setSpan("day")} />
          <Tab label="7 gün" active={span === "week"} onPress={() => setSpan("week")} />
        </View>

        {span === "day" ? (
          <Animated.View key="trace" style={styles.dayView} entering={arrive()}>
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

            {/* Full width, with the plot inset 24dp at each end — see `PLOT_INSET` in
                `trace.tsx`. The canvas still spans the screen; the first and last hours
                no longer sit against the bezel where nothing could reach them. */}
            {/* Remounting per day and activity resets the scrubber to that slice's best
                hour, which is what changing either was asking for. */}
            <Trace
              key={`${choice.key}-${selectedDay}`}
              slice={slice}
              width={width}
              initialIndex={startAt}
              nowIndex={
                selectedDay === today && plan.now_index != null
                  ? plan.now_index - today * 24
                  : null
              }
              onScrub={setScrubbed}
            />

            <Text style={styles.legend}>
              Çizgi ne kadar yüksekse o saat {choice.label.toLocaleLowerCase("tr")} için
              o kadar uygun. Kehribar bölümler sınırlarını geçen pencereler.
            </Text>
          </Animated.View>
        ) : (
          // Keyed on the mode so the cards re-enter each time the switch is thrown; the
          // stagger is most of what makes the change read as a change rather than a swap.
          <Animated.View key="calendar" style={styles.weekView} entering={arrive()}>
            <Calendar plan={plan} onSelectDay={showDay} />
            <Text style={styles.legend}>
              Her kart bir gün. Kehribar bantlar sınırlarını geçen saatler; hepsi aynı
              00–24 ekseninde, böylece açık saatler haftada bir sütun olarak okunur. Bir
              karta dokun, o günün izini aç.
            </Text>
          </Animated.View>
        )}
        </ScrollView>

        {picking ? (
          <Animated.View style={styles.picker} entering={arrive()} exiting={leave()}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>Yerler</Text>
              <Pressable onPress={() => setPicking(false)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.pickerClose}>Kapat</Text>
              </Pressable>
            </View>
            <Places onPicked={() => setPicking(false)} />
          </Animated.View>
        ) : null}
        </SkyProvider>
      </SafeAreaView>
    </View>
  );
}

/**
 * The place and how old the forecast is, in whatever ink the sky behind them wants.
 *
 * The place name is the way into the picker. It is where a person looks to find out where
 * they are looking, which makes it where they will try to change it — a settings row three
 * taps away would be somewhere else entirely.
 */
function Header({
  place,
  plan,
  onPress,
}: {
  place: string;
  plan: PlanResult;
  onPress: () => void;
}) {
  const ink = useInk();
  return (
    <>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.place, { color: ink.ink }]}>{place} ⌄</Text>
      </Pressable>
      <Text style={[styles.age, { color: ink.inkDim }]}>
        {plan.stale ? "bayat · " : ""}
        {formatAge(plan.fetched_at)}
      </Text>
    </>
  );
}

function Verdict({ window, label }: { window: Window; label: string }) {
  const ink = useInk();
  return (
    <View style={styles.verdict}>
      <Text style={[styles.day, { color: ink.ink }]}>{formatWindowDay(window)}</Text>
      <Text style={[styles.span, { color: ink.accent }]}>{formatWindowSpan(window)}</Text>
      <Text style={[styles.why, { color: ink.ink2 }]}>
        {label} için haftanın en iyi penceresi.
      </Text>
    </View>
  );
}

/**
 * Drawn from the device, because the server could not be reached.
 *
 * Said plainly and with the time on it. docs/10: a forecast without a time on it is a
 * lie, and this one is older than the header's staleness line implies — that number is
 * about the forecast, this is about the connection.
 *
 * Not styled as an error. Nothing is broken; the app is doing the thing it kept a cache
 * for. It is the same distinction docs/10 draws for the assistant being unreachable —
 * reduced capability, not a failure.
 */
function Offline({
  fetchedAt,
  onRefresh,
}: {
  fetchedAt: string;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineText}>
        Sunucuya ulaşılamıyor. Bu iz {formatAge(fetchedAt)} alınan tahminden.
      </Text>
      <Pressable onPress={onRefresh} hitSlop={8} accessibilityRole="button">
        <Text style={styles.offlineAction}>Yenile</Text>
      </Pressable>
    </View>
  );
}

function Empty({ blocker, label }: { blocker: PlanResult["blocker"]; label: string }) {
  const ink = useInk();
  return (
    <View style={styles.verdict}>
      <Text style={[styles.emptyHead, { color: ink.ink }]}>
        Bu hafta hiçbir saat sınırlarını geçmiyor
      </Text>
      {blocker ? (
        <Text style={[styles.why, { color: ink.ink2 }]}>
          {CONSTRAINT_LABELS[blocker.constraint] ?? blocker.constraint} limitin tek başına{" "}
          {blocker.hours} saati eledi.
        </Text>
      ) : (
        <Text style={[styles.why, { color: ink.ink2 }]}>
          {label} profilin için sonuç yok.
        </Text>
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
  picker: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "72%",
    backgroundColor: colors.ground2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: space.sm,
  },
  pickerHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  pickerTitle: { ...type.label, color: colors.burnHi },
  pickerClose: { ...type.label, color: colors.inkDim },

  offline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.glacial,
    marginBottom: space.md,
  },
  offlineText: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.ink2, flex: 1 },
  offlineAction: { ...type.label, color: colors.glacial },

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
