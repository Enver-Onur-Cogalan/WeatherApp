/**
 * Sor — the assistant.
 *
 * For anything the trace screen does not already answer. Deliberately not the front
 * door: most questions are answered deterministically on İz in milliseconds, and a
 * permanent question box would send them all to the model instead (ADR-0014).
 *
 * Two things the design insists on. The answer is a card built from schema fields, not
 * a paragraph — verdict, window, reason and warnings are separate and rendered as
 * components. And provenance is always shown: how many tools ran, how long it took, and
 * whether the sentence came from the model or the engine. An assistant that runs on your
 * own device should say so, and an answer the model did not write should not be
 * presented as though it had.
 */

import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { forgetExchange, recordExchange, useExchanges } from "@/db/exchanges";
import { Failure } from "@/components/states";
import { Thinking } from "@/components/thinking";
import {
  formatProvenance,
  SUGGESTIONS,
  VERDICT_LABELS,
  type Exchange,
} from "@/lib/ask";
import { DEFAULT_LOCATION } from "@/lib/config";
import { formatWindowDay, formatWindowSpan } from "@/lib/plan";
import { useChoices } from "@/lib/profiles";
import { arrive, leave } from "@/lib/motion";
import { useAsk } from "@/lib/queries";
import { colors, radius, size, space, type } from "@/theme";

export function AskScreen() {
  const [draft, setDraft] = useState("");
  // Read from SQLite rather than held in component state: history survived exactly as
  // long as the screen did before, which docs/11 lists as deletion by accident rather
  // than by choice.
  const exchanges = useExchanges();
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  // The first profile, which is the one İz opens on. Asking about a different profile
  // than the trace is showing would make two screens disagree about the same question.
  const { choices } = useChoices();
  const ask = useAsk(choices[0]);

  const toEnd = () =>
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

  const send = (question: string) => {
    const asked = question.trim();
    if (!asked || pending) return;

    setDraft("");
    setPending(asked);
    // Scroll after the pending row mounts, so the wait is visible rather than
    // happening somewhere off screen.
    toEnd();

    ask.mutate(asked, {
      onSuccess: (response) => {
        void recordExchange(asked, response);
        setPending(null);
        toEnd();
      },
      // The question stays on screen above the failure, so it is obvious which one
      // failed and the person can see what to retry.
      onError: toEnd,
    });
  };

  const retry = () => {
    const asked = pending;
    if (asked === null) return;
    setPending(null);
    send(asked);
  };

  const empty = exchanges.length === 0 && pending === null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Sor</Text>
        <Text style={styles.local}>{DEFAULT_LOCATION.name} · yerel</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.thread}
          keyboardDismissMode="interactive"
        >
          {empty ? <Empty onPick={send} /> : null}

          {exchanges.map((exchange) => (
            // `entering` and `exiting` on the turn rather than the card, so a question
            // and its answer arrive and leave as one thing — which is what they are.
            <Animated.View
              key={exchange.id}
              style={styles.turn}
              entering={arrive()}
              exiting={leave()}
            >
              <Question text={exchange.question} />
              <AnswerCard exchange={exchange} />
            </Animated.View>
          ))}

          {pending !== null ? (
            <Animated.View style={styles.turn} entering={arrive()}>
              <Question text={pending} />
              {ask.isError ? (
                <Failure error={ask.error} onRetry={retry} />
              ) : (
                <Thinking label="Cihazda düşünüyor" />
              )}
            </Animated.View>
          ) : null}
        </ScrollView>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          disabled={pending !== null}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Empty({ onPick }: { onPick: (question: string) => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyLead}>
        İz ekranının cevaplamadığı her şeyi buraya sorabilirsin. Cevaplar{" "}
        {DEFAULT_LOCATION.name} için, model cihazda çalışıyor — sorun hiçbir yere
        gitmiyor.
      </Text>
      <Text style={styles.emptyLabel}>Örnek sorular</Text>
      {SUGGESTIONS.map((question) => (
        <Pressable
          key={question}
          onPress={() => onPick(question)}
          style={styles.suggestion}
          accessibilityRole="button"
        >
          <Text style={styles.suggestionText}>{question}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Question({ text }: { text: string }) {
  return (
    <View style={styles.questionRow}>
      <Text style={styles.question}>{text}</Text>
    </View>
  );
}

/**
 * The answer, and what can be done with it.
 *
 * Long-press reveals copy and delete in place. docs/02's rule is native where a component
 * would only say the platform's name, and a context menu is exactly that — but `@expo/ui`'s
 * menus are native views that do not exist in Expo Go, which is where this app runs. So it
 * is drawn, and the same in-place pattern the profile rows already use.
 *
 * The haptic fires on the long-press itself, not when the menu finishes appearing: a
 * haptic that lags its cause reads as a glitch rather than as feedback. It is never the
 * only signal either — the menu is the signal, and haptics are off system-wide for plenty
 * of people.
 */
function AnswerCard({ exchange }: { exchange: Exchange }) {
  const { answer } = exchange.response;
  const window = answer.best_window;
  const [open, setOpen] = useState(false);

  const reveal = () => {
    setOpen(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View>
      <Pressable
        onLongPress={reveal}
        delayLongPress={350}
        style={styles.card}
        accessibilityRole="button"
        accessibilityHint="Uzun bas: kopyala veya sil"
      >
        <Text style={styles.verdict}>{VERDICT_LABELS[answer.verdict]}</Text>

        {window ? (
          <View style={styles.window}>
            <Text style={styles.windowDay}>{formatWindowDay(window)}</Text>
            <Text style={styles.windowSpan}>{formatWindowSpan(window)}</Text>
          </View>
        ) : null}

        <Text style={styles.reason}>{answer.reason}</Text>

        {answer.warnings.length > 0 ? (
          <View style={styles.warnings}>
            {answer.warnings.map((warning) => (
              <Text key={warning} style={styles.warning}>
                {warning}
              </Text>
            ))}
          </View>
        ) : null}
      </Pressable>

      {open ? (
        <Animated.View style={styles.actions} entering={arrive()} exiting={leave()}>
          <Pressable
            onPress={() => {
              void Clipboard.setStringAsync(asText(exchange));
              setOpen(false);
            }}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.actionQuiet}>Kopyala</Text>
          </Pressable>
          <Pressable
            onPress={() => void forgetExchange(exchange.id)}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.actionDestructive}>Sil</Text>
          </Pressable>
          <Pressable onPress={() => setOpen(false)} hitSlop={6} accessibilityRole="button">
            <Text style={styles.actionQuiet}>Kapat</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      <Text style={styles.provenance}>{formatProvenance(exchange.response)}</Text>

      {/* An answer the engine wrote is labelled rather than passed off as the model's. */}
      {!exchange.response.from_model ? (
        <Text style={styles.fellBack}>
          Asistan cevap veremedi, bu yanıt skorlama motorundan.
        </Text>
      ) : null}
    </View>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSend}
        placeholder="Bir şey sor"
        placeholderTextColor={colors.inkDim}
        editable={!disabled}
        returnKeyType="send"
        multiline
      />
      <Pressable
        onPress={onSend}
        disabled={disabled || value.trim().length === 0}
        hitSlop={8}
        style={[
          styles.send,
          (disabled || value.trim().length === 0) && styles.sendOff,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Gönder"
      >
        <Text style={styles.sendText}>Sor</Text>
      </Pressable>
    </View>
  );
}

/** What lands on the clipboard: the question and the answer, not the card's chrome. */
function asText(exchange: Exchange): string {
  const { answer } = exchange.response;
  const window = answer.best_window;
  return [
    exchange.question,
    "",
    window ? `${formatWindowDay(window)} ${formatWindowSpan(window)}` : null,
    answer.reason,
    ...answer.warnings,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: space.lg,
    paddingTop: space.sm,
    paddingHorizontal: space.md,
  },
  actionQuiet: { ...type.label, color: colors.inkDim },
  actionDestructive: { ...type.label, color: colors.ember },

  safe: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  title: { ...type.display, fontSize: size.title, color: colors.ink },
  local: { ...type.label, color: colors.inkDim },

  thread: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.xl },
  turn: { gap: space.md },

  empty: { gap: space.md, paddingTop: space.lg },
  emptyLead: { ...type.body, fontSize: size.body, lineHeight: 22, color: colors.ink2 },
  emptyLabel: { ...type.label, color: colors.inkDim, marginTop: space.lg },
  suggestion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  suggestionText: { ...type.body, fontSize: size.caption, color: colors.ink2 },

  questionRow: { alignItems: "flex-end" },
  question: {
    ...type.body,
    fontSize: size.caption,
    lineHeight: 19,
    color: colors.ink2,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    borderBottomRightRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    maxWidth: "85%",
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.burn,
    padding: space.md,
    gap: space.sm,
  },
  verdict: { ...type.label, color: colors.burnHi },
  window: { gap: 1 },
  windowDay: { ...type.display, fontSize: size.body, color: colors.ink },
  windowSpan: { ...type.data, fontSize: size.body, color: colors.burnHi },
  reason: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },

  warnings: {
    gap: space.xs,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleSoft,
  },
  warning: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.ember },

  provenance: { ...type.label, fontSize: 9, color: colors.inkDim, marginTop: space.sm },
  fellBack: { ...type.body, fontSize: 11, color: colors.inkDim, marginTop: space.xs },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
    backgroundColor: colors.ground,
  },
  input: {
    flex: 1,
    ...type.body,
    fontSize: size.caption,
    color: colors.ink,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    maxHeight: 96,
  },
  send: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.burnWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.burn,
  },
  sendOff: { opacity: 0.4 },
  sendText: { ...type.label, color: colors.burnHi },
});
