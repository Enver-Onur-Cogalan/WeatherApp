/**
 * Current conditions, in one line.
 *
 * The screen leads with a planning verdict, which is the product's argument. But most
 * people opening a weather app want the temperature, and the first build made them
 * scrub a comfort trace to find it — the evidence was there and unreachable without a
 * gesture. This puts it one glance away without taking the top spot from the verdict.
 */

import { useCopy, useLanguage } from "@/lib/i18n";
import { StyleSheet, Text, View } from "react-native";

import { useInk } from "@/components/legible";
import type { DaySummary, ScoredHour } from "@/lib/plan";
import { conditionLabel, isSevere } from "@/lib/weather-code";
import { colors, size, space, type } from "@/theme";

export function Now({ hour, today }: { hour: ScoredHour | null; today: DaySummary | null }) {
  // The ink comes from the block this sits in, which measured the sky behind it. The
  // severe colour deliberately does not move: it is a warning, and a warning that changes
  // shade with the time of day stops being one.
  const ink = useInk();
  const copy = useCopy();
  const language = useLanguage();

  // Without a current hour there is nothing honest to show, and a placeholder
  // temperature would be worse than none.
  if (!hour) return null;

  return (
    <View style={[styles.wrap, { borderColor: ink.rule }]}>
      <View style={styles.left}>
        <Text style={[styles.temp, { color: ink.ink }]}>
          {Math.round(hour.temperature_c)}°
        </Text>
        <Text
          style={[
            styles.condition,
            { color: ink.ink2 },
            isSevere(hour.weather_code) && styles.severe,
          ]}
        >
          {conditionLabel(hour.weather_code, language)}
        </Text>
      </View>

      {today ? (
        <View style={styles.right}>
          <Text style={[styles.range, { color: ink.ink2 }]}>
            <Text style={{ color: ink.inkDim }}>↑</Text> {Math.round(today.temp_max_c)}°{"  "}
            <Text style={{ color: ink.inkDim }}>↓</Text> {Math.round(today.temp_min_c)}°
          </Text>
          {today.precip_prob_max_pct > 0 ? (
            <Text style={[styles.rain, { color: ink.inkDim }]}>
              {copy.trace.precip(today.precip_prob_max_pct)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ruleSoft,
  },
  left: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  temp: { ...type.data, fontSize: 38, color: colors.ink },
  condition: { ...type.body, fontSize: size.body, color: colors.ink2 },
  severe: { color: colors.ember },

  right: { alignItems: "flex-end", gap: 2 },
  range: { ...type.data, fontSize: size.caption, color: colors.ink2 },
  arrow: { color: colors.inkDim },
  rain: { ...type.data, fontSize: 11, color: colors.glacial },
});
