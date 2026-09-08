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

import { useCopy, useLanguage, type Copy, type Language } from "@/lib/i18n";
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
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Animated, { LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { KEEP, forgetExchange, recordExchange, useExchanges } from "@/db/exchanges";
import { Failure } from "@/components/states";
import { Thinking } from "@/components/thinking";
import {
  formatProvenance,
  readingsOf,
  verdictLabel,
  type Exchange,
  type Reading,
} from "@/lib/ask";
import { useSelectedLocation } from "@/lib/locations";
import { formatWindowDay, formatWindowSpan } from "@/lib/plan";
import { useChoices } from "@/lib/profiles";
import { arrive, EASE_OUT, leave } from "@/lib/motion";
import { uuidv7 } from "@/lib/uuid";
import { useAsk, type AskPhase } from "@/lib/queries";
import { colors, radius, size, space, type } from "@/theme";

export function AskScreen() {
  const copy = useCopy();
  const [draft, setDraft] = useState("");
  // Read from SQLite rather than held in component state: history survived exactly as
  // long as the screen did before, which docs/11 lists as deletion by accident rather
  // than by choice.
  const exchanges = useExchanges();
  /**
   * The turn being answered, if any.
   *
   * It carries an id so the loading state can appear **where the turn is** rather than
   * always at the bottom: a new question gets a fresh id and lands below, an edited one
   * keeps its own and is replaced in place. One piece of state covers both, which is what
   * stops the two paths drifting.
   */
  const [pending, setPending] = useState<{ id: string; question: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  // The first profile, which is the one İz opens on. Asking about a different profile
  // than the trace is showing would make two screens disagree about the same question.
  const { choices } = useChoices();
  const { selected } = useSelectedLocation();
  const ask = useAsk(choices[0], selected);

  const toEnd = () =>
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

  /**
   * Open on the newest answer, not the oldest question.
   *
   * The thread only ever scrolled itself when a question was *sent*, so opening Sor put
   * you at the top — which with a full history is about seven screens above the last
   * thing the assistant said. Every thread in the world opens at the bottom; this one
   * opened a week in the past, and read as clutter because of it.
   *
   * Once, and not animated: this is where the screen starts, not something it does.
   * `settled` is only set after there is content to scroll to, because the live query
   * answers a frame after the first render and the empty thread would otherwise claim it.
   */
  const settled = useRef(false);
  const onFirstLayout = () => {
    if (settled.current || exchanges.length === 0) return;
    settled.current = true;
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: false }));
  };

  /**
   * Ask, either as a new turn or as a replacement for one.
   *
   * `id` decides which. Passing an existing exchange's id keeps its place in the thread
   * and overwrites it on success; the old answer never sits beside the new one, and a
   * failure leaves the original exactly where it was.
   */
  const send = (question: string, id?: string) => {
    const asked = question.trim();
    if (!asked || pending) return;

    const turn = { id: id ?? uuidv7(), question: asked };
    setDraft("");
    setEditing(null);
    setPending(turn);
    // Scroll after the pending row mounts, so the wait is visible rather than happening
    // somewhere off screen. Only for a new turn — an edit is already in view, and pulling
    // the thread to the bottom would move it away from what the person is watching.
    if (id === undefined) toEnd();

    ask.mutate(asked, {
      onSuccess: (response) => {
        void recordExchange(turn.id, asked, response);
        setPending(null);
        if (id === undefined) toEnd();
      },
      // The question stays on screen above the failure, so it is obvious which one failed
      // and what to retry.
      onError: () => {
        if (id === undefined) toEnd();
      },
    });
  };

  const retry = () => {
    if (pending === null) return;
    const { id, question } = pending;
    setPending(null);
    // Replacing an existing turn keeps its id; a new one had a fresh id already, and
    // reusing it means a retry cannot leave two rows behind.
    send(question, exchanges.some((item) => item.id === id) ? id : undefined);
  };

  const replacing = pending !== null && exchanges.some((item) => item.id === pending.id);

  const empty = exchanges.length === 0 && pending === null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{copy.tabs.ask}</Text>
        <Text style={styles.local}>{selected.label} · yerel</Text>
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
          onContentSizeChange={onFirstLayout}
        >
          {empty ? <Empty onPick={send} place={selected.label} /> : null}

          {/* Said only once the cap is actually evicting something. Before that it would
              be a policy nobody has run into; after it, it is the difference between a
              limit and questions quietly going missing. */}
          {exchanges.length >= KEEP ? (
            <Text style={styles.retention}>{copy.ask.kept(KEEP)}</Text>
          ) : null}

          {exchanges.map((exchange, index) => (
            // `entering` and `exiting` on the turn rather than the card, so a question
            // and its answer arrive and leave as one thing — which is what they are.
            // `layout` closes the gap when one is deleted instead of the rest jumping.
            <Animated.View
              key={exchange.id}
              style={styles.turn}
              entering={arrive()}
              exiting={leave()}
              layout={LinearTransition.duration(220).easing(EASE_OUT)}
            >
              {/* A week of questions is not one conversation. The rule goes where the day
                  changed, which is the only structure a thread this long has. */}
              {dayOf(exchange.createdAt) !== dayOf(exchanges[index - 1]?.createdAt) ? (
                <View style={styles.dayRule}>
                  <Text style={styles.dayLabel}>{dayLabel(exchange.createdAt, copy)}</Text>
                  <View style={styles.dayLine} />
                </View>
              ) : null}

              {pending?.id === exchange.id ? (
                <>
                  <Question text={pending.question} />
                  {ask.isError ? (
                    <Failure error={ask.error} onRetry={retry} />
                  ) : (
                    <Thinking label={phaseLabel(ask.phase ?? "gathering", copy)} />
                  )}
                </>
              ) : (
                <>
                  <Question
                    text={exchange.question}
                    editing={editing === exchange.id}
                    onEdit={() => setEditing(exchange.id)}
                    onCancelEdit={() => setEditing(null)}
                    onSubmitEdit={(next) => send(next, exchange.id)}
                  />
                  <AnswerCard exchange={exchange} />
                </>
              )}
            </Animated.View>
          ))}

          {pending !== null && !replacing ? (
            <Animated.View style={styles.turn} entering={arrive()}>
              <Question text={pending.question} />
              {ask.isError ? (
                <Failure error={ask.error} onRetry={retry} />
              ) : (
                <Thinking label={phaseLabel(ask.phase ?? "gathering", copy)} />
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

function Empty({ onPick, place }: { onPick: (question: string) => void; place: string }) {
  const copy = useCopy();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyLead}>{copy.ask.intro(place)}</Text>
      <Text style={styles.emptyLabel}>{copy.ask.examplesLabel}</Text>
      {copy.ask.examples.map((question: string) => (
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

/**
 * What was asked, and what can be done with it.
 *
 * Long-press reveals copy and edit. Editing happens **here**, in the bubble, rather than
 * in the composer at the bottom: the composer is where new questions go, and borrowing it
 * to change one halfway up the thread leaves a person typing in one place while watching
 * another.
 */
function Question({
  text,
  editing = false,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  text: string;
  editing?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (next: string) => void;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const [seenText, setSeenText] = useState(text);

  // The draft follows the question when it changes underneath — after an edit lands, or
  // when the row is reused for a different exchange. Adjusted during render rather than
  // in an effect: React documents this for exactly the case of resetting state when a
  // prop changes, and an effect would render the stale draft once before correcting it.
  if (text !== seenText) {
    setSeenText(text);
    setDraft(text);
  }

  if (editing) {
    const changed = draft.trim().length > 0 && draft.trim() !== text;
    return (
      <Animated.View style={styles.questionRow} entering={arrive()}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          style={[styles.question, styles.questionEditing]}
          multiline
          autoFocus
          onSubmitEditing={() => changed && onSubmitEdit?.(draft)}
        />
        <View style={styles.menu}>
          <IconAction
            icon="check"
            label={copy.ask.saveAndAsk}
            tone={changed ? "accent" : "quiet"}
            onPress={() => changed && onSubmitEdit?.(draft)}
          />
          <IconAction
            icon="close"
            label={copy.common.cancel}
            onPress={() => {
              setDraft(text);
              onCancelEdit?.();
            }}
          />
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.questionRow}>
      <Pressable
        onLongPress={() => {
          setOpen(true);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityHint={copy.ask.longPressHint}
      >
        <Text style={[styles.question, open && styles.dimmed]}>{text}</Text>
      </Pressable>

      {open ? (
        <Animated.View style={styles.menuOver} entering={arrive()} exiting={leave()}>
          <IconAction
            icon="content-copy"
            label={copy.common.copy}
            onPress={() => {
              void Clipboard.setStringAsync(text);
              setOpen(false);
            }}
          />
          <IconAction
            icon="pencil-outline"
            label={copy.common.edit}
            onPress={() => {
              setOpen(false);
              onEdit?.();
            }}
          />
          <IconAction icon="close" label={copy.ask.close} onPress={() => setOpen(false)} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * One action in a long-press menu.
 *
 * Icons rather than words, on a surface rather than floating. The first version was three
 * words in a row under the card, which read as body text that happened to be tappable —
 * a menu has to look like a thing you act on, not like a sentence.
 *
 * The label is not shown and is not optional: an icon-only control with no accessible
 * name is a button a screen reader announces as nothing at all.
 */
function IconAction({
  icon,
  label,
  onPress,
  tone = "quiet",
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  onPress: () => void;
  tone?: "quiet" | "accent" | "destructive";
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={icon}
        size={17}
        color={
          tone === "destructive"
            ? colors.ember
            : tone === "accent"
              ? colors.burnHi
              : colors.ink2
        }
      />
    </Pressable>
  );
}

/**
 * What the assistant is doing, in words rather than as a fraction.
 *
 * The wait is around forty seconds and the two halves are not equal — gathering the data
 * took 28 of a measured 34, composing the sentence took 6. A single "thinking…" for all of
 * it says nothing; these say which half, which is the only honest progress available since
 * the agent does not know how far through it is.
 *
 * `repairing` is the interesting one. It means a gate rejected the answer and the model is
 * being asked again — a wait getting longer because the thing is being checked, not
 * because it is stuck, and worth saying so.
 */
function phaseLabel(phase: AskPhase, copy: Copy): string {
  return copy.ask.phases[phase];
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
  const copy = useCopy();
  const language = useLanguage();
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
        style={[styles.card, open && styles.dimmed]}
        accessibilityRole="button"
        accessibilityHint="Uzun bas: kopyala veya sil"
      >
        {/* A factual question gets no verdict, and the card says nothing rather than
            inventing a label for it. "Yarın kaç derece?" is not good, mixed or bad. */}
        {answer.verdict ? (
          <Text style={styles.verdict}>{verdictLabel(answer.verdict, language)}</Text>
        ) : null}

        {window ? (
          <>
            <View style={styles.window}>
              <Text style={styles.windowDay}>{formatWindowDay(window, language)}</Text>
              <Text style={styles.windowSpan}>{formatWindowSpan(window)}</Text>
            </View>
            <Readings readings={readingsOf(window, language)} />
          </>
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
        <Animated.View style={styles.menuOver} entering={arrive()} exiting={leave()}>
          <IconAction
            icon="content-copy"
            label={copy.common.copy}
            onPress={() => {
              void Clipboard.setStringAsync(asText(exchange, language));
              setOpen(false);
            }}
          />
          <IconAction
            icon="trash-can-outline"
            label={copy.common.delete}
            tone="destructive"
            onPress={() => void forgetExchange(exchange.id)}
          />
          <IconAction icon="close" label={copy.ask.close} onPress={() => setOpen(false)} />
        </Animated.View>
      ) : null}

      <Text style={styles.provenance}>
        {formatProvenance(exchange.response, language)}
      </Text>

      {/* An answer the engine wrote is labelled rather than passed off as the model's. */}
      {!exchange.response.from_model ? (
        <Text style={styles.fellBack}>{copy.ask.fromEngine}</Text>
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
  const copy = useCopy();
  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSend}
        placeholder={copy.ask.placeholder}
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
        accessibilityLabel={copy.ask.send}
      >
        <Text style={styles.sendText}>{copy.ask.sendLabel}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The window's conditions, drawn as readings.
 *
 * Monospaced and labelled, like every other number in this app — the engine produced them,
 * so they are shown the way the trace's readout shows its own (docs/10).
 */
function Readings({ readings }: { readings: Reading[] }) {
  if (readings.length === 0) return null;

  return (
    <View style={styles.readings}>
      {readings.map((reading) => (
        <View key={reading.label} style={styles.reading}>
          <Text style={styles.readingLabel}>{reading.label}</Text>
          <Text
            style={[
              styles.readingValue,
              reading.tone === "cool" && styles.readingCool,
              reading.tone === "warn" && styles.readingWarn,
            ]}
          >
            {reading.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** What lands on the clipboard: the question and the answer, not the card's chrome. */
/** The local calendar day an exchange belongs to, as a key rather than a label. */
function dayOf(iso: string | undefined): string {
  if (iso === undefined) return "";
  const when = new Date(iso);
  return `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
}

/**
 * What to call that day.
 *
 * "Bugün" and "Dün" rather than a date, because for the two most recent days a name is
 * what a person actually holds in their head. Older than that, the date is the only thing
 * that means anything.
 */
function dayLabel(iso: string, copy: Copy): string {
  const when = new Date(iso);
  const now = new Date();

  if (dayOf(iso) === dayOf(now.toISOString())) return copy.today;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayOf(iso) === dayOf(yesterday.toISOString())) return copy.ask.yesterday;

  return `${copy.weekdays[when.getDay()]}, ${copy.card.date(when.getDate(), copy.months[when.getMonth()])}`;
}

function asText(exchange: Exchange, language: Language): string {
  const { answer } = exchange.response;
  const window = answer.best_window;
  return [
    exchange.question,
    "",
    window ? `${formatWindowDay(window, language)} ${formatWindowSpan(window)}` : null,
    answer.reason,
    ...answer.warnings,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

const styles = StyleSheet.create({
  retention: {
    ...type.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.inkDim,
    textAlign: "center",
    paddingBottom: space.sm,
  },
  dayRule: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingBottom: space.xs,
  },
  dayLabel: { ...type.label, color: colors.inkDim },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.ruleSoft },

  readings: {
    flexDirection: "row",
    gap: space.lg,
    paddingTop: space.xs,
    paddingBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ruleSoft,
  },
  reading: { gap: 1 },
  readingLabel: { ...type.label, fontSize: 9, color: colors.inkDim },
  readingValue: { ...type.data, fontSize: size.caption, color: colors.ink },
  readingCool: { color: colors.glacial },
  readingWarn: { color: colors.ember },

  /**
   * Over the thing it acts on, not under it.
   *
   * It sat below the card first, and the connection broke: a row of controls under a card
   * reads as belonging to whatever comes next as easily as to what came before. Laid on
   * top there is nothing to infer — and the card dims behind it, which says the same thing
   * a second way for anyone who does not read position as meaning.
   */
  menuOver: {
    position: "absolute",
    top: space.sm,
    right: space.sm,
    flexDirection: "row",
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    // Enough lift to read as above the surface rather than cut into it. Android needs
    // elevation; iOS ignores it and takes the shadow.
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  dimmed: { opacity: 0.45 },

  // The editing controls stay in flow: nothing is being pointed at, the field is the
  // subject, and floating them would cover the text being typed.
  menu: {
    flexDirection: "row",
    alignSelf: "flex-end",
    gap: space.xs,
    marginTop: space.sm,
    padding: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  iconButton: {
    width: 34,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  iconPressed: { backgroundColor: colors.surface },
  questionEditing: {
    borderColor: colors.burn,
    backgroundColor: colors.ground2,
    color: colors.ink,
    minWidth: "70%",
  },

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
