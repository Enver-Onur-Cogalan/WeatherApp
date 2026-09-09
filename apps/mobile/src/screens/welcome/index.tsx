/**
 * The gate.
 *
 * Three ways in, and the third is a first-class one. ADR-0009 says guest mode exists
 * because the first person to open this project will not create an account to look
 * around and should not have to — so "carry on without an account" is not a small link
 * under a form, and the screen says plainly what an account is *for* rather than implying
 * that skipping it costs anything.
 *
 * The choice is remembered. A gate that reappears every launch is the wall the ADR was
 * written against; being asked once is fine, being asked forever is not.
 *
 * Reached from two directions. Before the app has been entered, it is the first screen
 * and there is nothing behind it. From Sen, a guest who has changed their mind arrives
 * here with the app still underneath, so a way back appears — the same screen, one
 * affordance different, rather than two screens that must be kept in step.
 *
 * **What it looks like, and why it is not weather.** This was a form with a title on it,
 * which is the wrong first impression for the most graphics-heavy app in this repository.
 * The obvious fix — put the atmosphere layer behind it — is ruled out by ADR-0013, which
 * keeps that layer only while it encodes real data, and here there is no place, no
 * forecast and possibly no server. Drawing a sky that stands for nothing is precisely
 * what that decision refuses.
 *
 * So the screen borrows the *instrument* rather than the weather: the name is scorched
 * onto a recorder card by a travelling point of light, once, on arrival. A curve would
 * have been the tempting choice and is the one thing that cannot go here — `thinking.tsx`
 * records why, having already learned that a surface drawing the same shape the week
 * cards draw with real data stops reading as an instrument and starts reading as a
 * forecast. Letterforms cannot be misread that way.
 */

import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { BurnIn } from "@/components/burn-in";
import { Button, Field } from "@/components/controls";
import { moveProfilesToAccount, pendingProfiles } from "@/db/handoff";
import { AuthError, useAuth } from "@/lib/auth";
import { copyFor, useCopy, useLanguage, type Language } from "@/lib/i18n";
import { arrive } from "@/lib/motion";
import { colors, size, space, type } from "@/theme";

/** docs/07: length is what matters, so the only rule is a floor, and it is stated. */
const MIN_PASSWORD = 10;

type Mode = "choose" | "in" | "up" | "handoff";

export function WelcomeScreen() {
  const copy = useCopy();
  const chosenGuest = useAuth((state) => state.chosenGuest);
  const status = useAuth((state) => state.status);
  const [mode, setMode] = useState<Mode>("choose");

  // Anyone who has already answered the gate got here from Sen, so the app is behind
  // this screen and closing it is a real option. On first launch there is nothing to go
  // back to, and offering it would be a dead end.
  const dismissable = chosenGuest || status === "signed-in";

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.masthead}>
              <BurnIn text="WeatherApp" size={40} />
              <Text style={styles.lede}>{copy.welcome.pitch}</Text>
            </View>

            {mode === "choose" ? (
              <Choose onPick={setMode} dismissable={dismissable} onDismiss={leave} />
            ) : mode === "handoff" ? (
              <Handoff onDone={leave} />
            ) : (
              <Credentials
                mode={mode}
                onBack={() => setMode("choose")}
                // Signing in does not end the flow if this device is carrying profiles
                // that belong to nobody. Uploading them without asking would contradict
                // the sentence guest mode is justified by (ADR-0009), so it is a step.
                onDone={async () =>
                  (await pendingProfiles()).length > 0 ? setMode("handoff") : leave()
                }
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Choose({
  onPick,
  dismissable,
  onDismiss,
}: {
  onPick: (mode: Mode) => void;
  dismissable: boolean;
  onDismiss: () => void;
}) {
  const continueAsGuest = useAuth((state) => state.continueAsGuest);
  const [busy, setBusy] = useState(false);
  const copy = useCopy();

  const asGuest = async () => {
    setBusy(true);
    await continueAsGuest();
    onDismiss();
  };

  return (
    <Animated.View style={styles.stack} entering={arrive()}>
      <Button label={copy.welcome.signUp} onPress={() => onPick("up")} />
      <Button
        label={copy.welcome.signIn}
        onPress={() => onPick("in")}
        variant="secondary"
      />

      <View style={styles.rule} />

      <Button
        label={copy.welcome.asGuest}
        onPress={() => void asGuest()}
        variant="quiet"
        busy={busy}
      />
      {/* Two sentences, not four. What stays on the phone, and what an account changes. */}
      <Text style={styles.note}>
        <Text style={styles.noteLead}>{copy.welcome.guestTitle} </Text>
        {copy.welcome.guestBody}
      </Text>

      {dismissable ? (
        <Pressable onPress={onDismiss} style={styles.dismiss} accessibilityRole="button">
          <Text style={styles.dismissText}>{copy.common.cancel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function Credentials({
  mode,
  onBack,
  onDone,
}: {
  mode: "in" | "up";
  onBack: () => void;
  onDone: () => void | Promise<void>;
}) {
  const signIn = useAuth((state) => state.signIn);
  const signUp = useAuth((state) => state.signUp);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const copy = useCopy();
  const language = useLanguage();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const ready = email.includes("@") && password.length >= MIN_PASSWORD && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    try {
      await (mode === "in" ? signIn(email, password) : signUp(email, password));
      await onDone();
    } catch (error) {
      setFailure(describe(error, mode, language));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "in" ? copy.welcome.signIn : copy.welcome.signUp;

  return (
    <Animated.View style={styles.stack} entering={arrive()}>
      <Text style={styles.formTitle}>{title}</Text>

      <Field
        label={copy.welcome.email}
        value={email}
        onChange={setEmail}
        placeholder={copy.welcome.emailPlaceholder}
        keyboardType="email-address"
        autoComplete="email"
        returnKeyType="next"
        autoFocus
      />
      <Field
        label={copy.welcome.password}
        value={password}
        onChange={setPassword}
        placeholder={copy.welcome.passwordPlaceholder(MIN_PASSWORD)}
        secureTextEntry
        autoComplete={mode === "in" ? "current-password" : "new-password"}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        // Said while typing rather than after submitting. docs/10 wants a control to say
        // what will happen, and a rule you only learn by failing is the opposite of that.
        hint={tooShort ? copy.welcome.passwordHint(MIN_PASSWORD) : null}
      />

      {failure !== null ? <Text style={styles.failure}>{failure}</Text> : null}

      <Button
        label={busy ? "…" : title}
        onPress={() => void submit()}
        disabled={!ready}
        busy={busy}
      />

      <Pressable onPress={onBack} style={styles.dismiss} accessibilityRole="button">
        <Text style={styles.dismissText}>{copy.welcome.back}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The offer: move what is on this phone into the account that was just opened.
 *
 * Shown only when there is something to move, and declining is a real answer — the same
 * offer waits in Sen afterwards. "Nothing is stored unless you ask us to" is the position
 * that justifies guest mode existing, and an upload that happens automatically the moment
 * someone signs in is that position being quietly dropped.
 */
function Handoff({ onDone }: { onDone: () => void }) {
  const account = useAuth((state) => state.account);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null);
  const copy = useCopy();

  useEffect(() => {
    void pendingProfiles().then((profiles) => setCount(profiles.length));
  }, []);

  const move = async () => {
    if (account === null) return;
    setBusy(true);
    setResult(await moveProfilesToAccount(account.id));
    setBusy(false);
  };

  if (result !== null) {
    return (
      <Animated.View style={styles.stack} entering={arrive()}>
        <Text style={styles.formTitle}>
          {result.failed === 0 ? copy.welcome.movedTitle : copy.welcome.partlyMovedTitle}
        </Text>
        <Text style={styles.note}>
          {copy.welcome.moved(result.moved)}
          {result.failed > 0 ? copy.welcome.failedToMove(result.failed) : ""}
        </Text>
        <Button label={copy.welcome.carryOn} onPress={onDone} />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={styles.stack} entering={arrive()}>
      <Text style={styles.formTitle}>{copy.welcome.onThisDevice}</Text>
      <Text style={styles.note}>
        {copy.welcome.offer(count === null ? "…" : String(count))}
      </Text>

      <Button
        label={busy ? copy.you.moving : copy.you.moveToAccount}
        onPress={() => void move()}
        disabled={count === null}
        busy={busy}
      />

      <Pressable onPress={onDone} style={styles.dismiss} accessibilityRole="button">
        <Text style={styles.dismissText}>{copy.welcome.keepForNow}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A failure, in words a person can act on.
 *
 * The server refuses to say whether an address exists (docs/07), so the wrong-credentials
 * message covers both cases and must not imply otherwise — a friendlier "no such account"
 * would leak exactly what the endpoint is careful to protect.
 */
function describe(error: unknown, mode: "in" | "up", language: Language): string {
  const copy = copyFor(language).welcome;
  if (!(error instanceof AuthError)) return copy.unexpected;

  switch (error.status) {
    case 0:
      return copy.unreachable;
    case 401:
      return copy.wrongCredentials;
    case 409:
      return copy.accountExists;
    case 422:
      return mode === "up" ? copy.invalid(MIN_PASSWORD) : copy.refused;
    case 429:
      return copy.tooMany;
    default:
      return copy.serverFailed;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl,
    paddingBottom: space.xl,
    gap: space.xxl,
  },

  /**
   * Takes the space the buttons do not, and centres itself in it.
   *
   * `space-between` on the container was the first version, and on a tall phone it opened
   * a hand's width of nothing between the wordmark and the first button — the two pieces
   * of content pinned to opposite ends of a screen with little on it. The choice still
   * sits under the thumb; the name is now in the middle of what is left rather than
   * against the top of it.
   */
  masthead: { flex: 1, justifyContent: "center", gap: space.md },
  lede: {
    ...type.body,
    fontSize: size.body,
    lineHeight: 24,
    color: colors.ink2,
    // Under 80 characters a line, which at this size is most of the width anyway.
    maxWidth: 420,
  },

  stack: { gap: space.md },
  formTitle: { ...type.heading, fontSize: size.title, color: colors.ink },

  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.ruleSoft,
    marginVertical: space.xs,
  },

  note: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.inkDim },
  /** The claim, in the reading ink; the detail behind it stays quiet. */
  noteLead: { color: colors.ink2 },

  failure: { ...type.body, fontSize: size.caption, lineHeight: 19, color: colors.ember },

  dismiss: { alignSelf: "center", paddingVertical: space.sm, paddingHorizontal: space.md },
  dismissText: { ...type.label, color: colors.inkDim },
});
