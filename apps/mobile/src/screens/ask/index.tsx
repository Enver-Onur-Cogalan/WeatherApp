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
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  askAssistant,
  formatProvenance,
  SUGGESTIONS,
  VERDICT_LABELS,
  type Exchange,
} from "@/lib/ask";
import { formatWindowDay, formatWindowSpan } from "@/lib/plan";
import { colors, radius, size, space, type } from "@/theme";

export function AskScreen() {
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  const send = async (question: string) => {
    const asked = question.trim();
    if (!asked || pending) return;

    setDraft("");
    setPending(asked);
    // Scroll after the pending row mounts, so the wait is visible rather than
    // happening somewhere off screen.
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

    const response = await askAssistant(asked);
    setExchanges((current) => [
      ...current,
      { id: `${Date.now()}`, question: asked, response },
    ]);
    setPending(null);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  };

  const empty = exchanges.length === 0 && pending === null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Sor</Text>
        <Text style={styles.local}>yerel</Text>
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
            <View key={exchange.id} style={styles.turn}>
              <Question text={exchange.question} />
              <AnswerCard exchange={exchange} />
            </View>
          ))}

          {pending !== null ? (
            <View style={styles.turn}>
              <Question text={pending} />
              <Thinking />
            </View>
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
        İz ekranının cevaplamadığı her şeyi buraya sorabilirsin. Model cihazda çalışıyor —
        sorun hiçbir yere gitmiyor.
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

function Thinking() {
  return (
    <View style={[styles.card, styles.thinking]}>
      <ActivityIndicator color={colors.burnHi} size="small" />
      <Text style={styles.thinkingText}>Cihazda düşünüyor…</Text>
    </View>
  );
}

function AnswerCard({ exchange }: { exchange: Exchange }) {
  const { answer } = exchange.response;
  const window = answer.best_window;

  return (
    <View>
      <View style={styles.card}>
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
      </View>

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

const styles = StyleSheet.create({
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

  thinking: { flexDirection: "row", alignItems: "center", gap: space.md },
  thinkingText: { ...type.body, fontSize: size.caption, color: colors.inkDim },

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
