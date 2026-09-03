/**
 * The gate.
 *
 * Three ways in, and the third is a first-class one. ADR-0009 says guest mode exists
 * because the first person to open this project will not create an account to look
 * around and should not have to — so "Misafir olarak devam et" is not a small link under
 * a form, and the screen says plainly what an account is *for* rather than implying that
 * skipping it costs anything.
 *
 * The choice is remembered. A gate that reappears every launch is the wall the ADR was
 * written against; being asked once is fine, being asked forever is not.
 *
 * Reached from two directions. Before the app has been entered, it is the first screen
 * and there is nothing behind it. From Sen, a guest who has changed their mind arrives
 * here with the app still underneath, so a way back appears — the same screen, one
 * affordance different, rather than two screens that must be kept in step.
 *
 * No atmosphere layer here, deliberately. It would look good and it is the app's most
 * distinctive surface — but ADR-0013 defines it as a second reading of the forecast
 * rather than decoration, and on this screen there is no location, no forecast, and
 * possibly no server. Drawing weather that stands for nothing is exactly what that ADR
 * rules out, so the gate is typography on the instrument's own ground.
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
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { moveProfilesToAccount, pendingProfiles } from "@/db/handoff";
import { AuthError, useAuth } from "@/lib/auth";
import { colors, radius, size, space, type } from "@/theme";

/** docs/07: length is what matters, so the only rule is a floor, and it is stated. */
const MIN_PASSWORD = 10;

type Mode = "choose" | "in" | "up" | "handoff";

export function WelcomeScreen() {
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
          >
            <View style={styles.masthead}>
              <Text style={styles.eyebrow}>Hava, planlanabilir</Text>
              <Text style={styles.wordmark}>WeatherApp</Text>
              <Text style={styles.lede}>
                Ne zaman dışarı çıkacağını söyleyen bir asistan. Model senin sunucunda
                çalışıyor — sorduğun hiçbir şey başka bir yere gitmiyor.
              </Text>
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

  const asGuest = async () => {
    setBusy(true);
    await continueAsGuest();
    onDismiss();
  };

  return (
    <View style={styles.stack}>
      <Pressable
        onPress={() => onPick("up")}
        style={styles.primary}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>Hesap aç</Text>
      </Pressable>

      <Pressable
        onPress={() => onPick("in")}
        style={styles.secondary}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>Giriş yap</Text>
      </Pressable>

      <View style={styles.rule} />

      <Pressable
        onPress={asGuest}
        disabled={busy}
        style={[styles.guest, busy && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.guestText}>Misafir olarak devam et</Text>
      </Pressable>
      <Text style={styles.guestNote}>
        Uygulamanın tamamı hesapsız çalışır. Profillerin ve konumların yalnızca bu
        cihazda kalır; hiçbir şey sunucuya gitmez.
      </Text>
      <Text style={styles.guestNote}>
        Hesap açmak, bunları sunucuna kaydeder — telefonunu değiştirsen de durur, ikinci
        cihazından da açılır. Sonradan da açabilirsin.
      </Text>

      {dismissable ? (
        <Pressable onPress={onDismiss} style={styles.dismiss} accessibilityRole="button">
          <Text style={styles.dismissText}>Vazgeç</Text>
        </Pressable>
      ) : null}
    </View>
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
      setFailure(describe(error, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.formTitle}>{mode === "in" ? "Giriş yap" : "Hesap aç"}</Text>

      <Field
        label="E-posta"
        value={email}
        onChange={setEmail}
        placeholder="ornek@site.com"
        keyboardType="email-address"
        autoComplete="email"
        autoFocus
      />
      <Field
        label="Parola"
        value={password}
        onChange={setPassword}
        placeholder={`En az ${MIN_PASSWORD} karakter`}
        secureTextEntry
        autoComplete={mode === "in" ? "current-password" : "new-password"}
      />

      {tooShort ? (
        // Said while typing rather than after submitting. docs/10 wants a control to say
        // what will happen, and a rule you only learn by failing is the opposite of that.
        <Text style={styles.hint}>
          Parola en az {MIN_PASSWORD} karakter. Uzunluk önemli, karakter çeşidi değil.
        </Text>
      ) : null}

      {failure !== null ? <Text style={styles.failure}>{failure}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={!ready}
        style={[styles.primary, !ready && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>
          {busy ? "…" : mode === "in" ? "Giriş yap" : "Hesap aç"}
        </Text>
      </Pressable>

      <Pressable onPress={onBack} style={styles.dismiss} accessibilityRole="button">
        <Text style={styles.dismissText}>Geri</Text>
      </Pressable>
    </View>
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
      <View style={styles.stack}>
        <Text style={styles.formTitle}>
          {result.failed === 0 ? "Taşındı" : "Kısmen taşındı"}
        </Text>
        <Text style={styles.guestNote}>
          {result.moved} profil hesabına kaydedildi.
          {result.failed > 0
            ? ` ${result.failed} tanesi gönderilemedi — cihazda duruyor, Sen sekmesinden tekrar deneyebilirsin.`
            : ""}
        </Text>
        <Pressable onPress={onDone} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>Devam et</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.formTitle}>Bu cihazdaki profiller</Text>
      <Text style={styles.guestNote}>
        Misafirken {count ?? "…"} profil oluşturmuşsun. Hesabına taşıyalım mı? Taşırsan
        başka cihazdan da açılır. Taşımazsan bu telefonda kalmaya devam eder.
      </Text>

      <Pressable
        onPress={move}
        disabled={busy || count === null}
        style={[styles.primary, (busy || count === null) && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{busy ? "Taşınıyor…" : "Hesabıma taşı"}</Text>
      </Pressable>

      <Pressable onPress={onDone} style={styles.dismiss} accessibilityRole="button">
        <Text style={styles.dismissText}>Şimdilik kalsın</Text>
      </Pressable>
    </View>
  );
}

/**
 * A failure, in words a person can act on.
 *
 * The server refuses to say whether an address exists (docs/07), so the wrong-credentials
 * message covers both cases and must not imply otherwise — a friendlier "böyle bir hesap
 * yok" would leak exactly what the endpoint is careful to protect.
 */
function describe(error: unknown, mode: "in" | "up"): string {
  if (!(error instanceof AuthError)) {
    return "Beklenmeyen bir sorun oldu. Tekrar dene.";
  }
  switch (error.status) {
    case 0:
      return "Sunucuya ulaşılamadı. Backend çalışıyor mu ve aynı ağda mısın, kontrol et.";
    case 401:
      return "E-posta veya parola hatalı.";
    case 409:
      return "Bu adreste zaten bir hesap var. Giriş yapmayı dene.";
    case 422:
      return mode === "up"
        ? `Adres geçerli bir e-posta olmalı, parola en az ${MIN_PASSWORD} karakter.`
        : "Girilen bilgiler kabul edilmedi.";
    case 429:
      return "Çok fazla deneme oldu. Birkaç dakika bekle.";
    default:
      return "Sunucu bu isteği tamamlayamadı. Tekrar dene.";
  }
}

function Field({
  label,
  value,
  onChange,
  ...input
  // `onChange` is omitted deliberately: TextInput has one of its own that takes an event,
  // and spreading both leaves a prop that must satisfy two incompatible shapes.
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
} & Omit<React.ComponentProps<typeof TextInput>, "onChange" | "value">) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChange}
        style={styles.input}
        placeholderTextColor={colors.inkDim}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl,
    paddingBottom: space.xl,
    justifyContent: "space-between",
    gap: space.xxl,
  },

  masthead: { gap: space.sm },
  eyebrow: { ...type.label, color: colors.burnHi },
  wordmark: { ...type.display, fontSize: 34, lineHeight: 40, color: colors.ink },
  lede: {
    ...type.body,
    fontSize: size.body,
    lineHeight: 23,
    color: colors.ink2,
    marginTop: space.xs,
  },

  stack: { gap: space.md },
  formTitle: { ...type.label, color: colors.burnHi, marginBottom: space.xs },

  primary: {
    alignItems: "center",
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
    backgroundColor: colors.burnWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.burn,
  },
  primaryText: { ...type.label, color: colors.burnHi },

  secondary: {
    alignItems: "center",
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  secondaryText: { ...type.label, color: colors.ink2 },

  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.ruleSoft,
    marginVertical: space.xs,
  },

  guest: { alignItems: "center", paddingVertical: space.md },
  guestText: { ...type.label, color: colors.ink },
  guestNote: { ...type.body, fontSize: 12, lineHeight: 18, color: colors.inkDim },

  field: { gap: space.xs },
  fieldLabel: { ...type.label, color: colors.inkDim },
  input: {
    ...type.body,
    fontSize: size.caption,
    color: colors.ink,
    backgroundColor: colors.ground2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  hint: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.inkDim },
  failure: { ...type.body, fontSize: 12, lineHeight: 17, color: colors.ember },

  dismiss: { alignItems: "center", paddingVertical: space.sm },
  dismissText: { ...type.label, color: colors.inkDim },
  dim: { opacity: 0.4 },
});
