/**
 * What a screen shows when it has no data yet, or cannot get any.
 *
 * Both screens needed these the moment they stopped reading fixtures, and a fixture
 * always answers — which is why the app had no failure path at all until now (F4 in
 * docs/13). Shared rather than written twice: two screens disagreeing about how a
 * server being unreachable looks is how an interface stops feeling like one thing.
 *
 * The copy rule is docs/10's. An error names what happened and what would change it, in
 * the interface's voice, with no apologies and no vagueness — and the retry is only
 * offered when pressing it could plausibly work.
 */

import { useCopy, useLanguage } from "@/lib/i18n";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeError, isWorthRetrying } from "@/lib/ask";
import { colors, radius, size, space, type } from "@/theme";

export function Failure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const copy = useCopy();
  const { title, detail, technical } = describeError(error, useLanguage());
  const retryable = onRetry !== undefined && isWorthRetrying(error);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {technical ? <Text style={styles.technical}>{technical}</Text> : null}
      {retryable ? (
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>{copy.common.retry}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The trace screen while the first plan is in flight.
 *
 * Deliberately plain. The plan endpoint is arithmetic over a cached forecast and returns
 * in well under a second, so anything elaborate here would be a flourish nobody sees —
 * unlike the assistant's wait, which is 27 seconds and got its own drawing (`thinking`).
 */
export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.ember,
    padding: space.md,
    gap: space.sm,
  },
  title: { ...type.label, color: colors.ember },
  detail: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },
  // Monospaced: this line is an address or a field path, and it is meant to be read
  // character by character rather than skimmed.
  technical: { ...type.data, fontSize: 11, lineHeight: 16, color: colors.inkDim },
  retry: {
    alignSelf: "flex-start",
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  retryText: { ...type.label, color: colors.ink2 },

  loading: { paddingVertical: space.xxl, alignItems: "center" },
  loadingText: { ...type.label, color: colors.inkDim },
});
