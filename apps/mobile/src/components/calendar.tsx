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

import { copyFor, useLanguage, type Language } from "@/lib/i18n";
import { StyleSheet, View } from "react-native";

import { DayCard, type Day } from "@/components/day-card";
import type { PlanResult, Window } from "@/lib/plan";
import { space } from "@/theme";

const HOURS = 24;

/**
 * Days come from the server's own grouping.
 *
 * The client never re-derives where a day starts from UTC — if it did, the cards and the
 * trace would disagree about which window belongs to which day, twice a year at least.
 */
function groupByDay(plan: PlanResult, language: Language): Day[] {
  const copy = copyFor(language);
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
      weekday: index === 0 ? copy.today : copy.weekdays[when.getUTCDay()],
      dayLabel: copy.card.date(day, copy.months[month - 1]),
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
  const days = groupByDay(plan, useLanguage());

  return (
    <View style={styles.stack}>
      {days.map((day, index) => (
        // The stagger lives in the card, because what is staggered is the burn rather
        // than the card's own arrival — the stock is there, and the day appears on it.
        <DayCard
          key={day.date}
          day={day}
          index={index}
          onPress={() => onSelectDay(index)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm, paddingHorizontal: space.lg },
});
