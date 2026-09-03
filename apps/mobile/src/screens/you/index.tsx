/**
 * Sen — the account, and eventually everything attached to it.
 *
 * Signing in is offered, never required. Guest mode is the design (ADR-0009): the first
 * person to open a portfolio project will not create an account to look around, and
 * "nothing is stored unless you ask us to" is a position rather than a missing feature.
 * So the screen leads with what an account *buys* — profiles and places that survive a
 * reinstall and reach a second device — rather than with a wall.
 *
 * Profiles, locations, notifications and the assistant's status still belong here
 * (docs/11) and are not built.
 */

import { useState } from "react";
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

import { AuthError, useAuth } from "@/lib/auth";
import { colors, radius, size, space, type } from "@/theme";

/** docs/07: length is what matters, so the only rule is a floor, and it is stated. */
const MIN_PASSWORD = 10;

export function YouScreen() {
  const status = useAuth((state) => state.status);
  const account = useAuth((state) => state.account);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardDismissMode="interactive">
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Ayarlar</Text>
            <Text style={styles.title}>Sen</Text>
          </View>

          {status === "restoring" ? (
            <View style={styles.restoring}>
              <ActivityIndicator color={colors.burnHi} size="small" />
            </View>
          ) : status === "signed-in" && account !== null ? (
            <SignedIn email={account.email} />
          ) : (
            <SignedOut />
          )}

          <Text style={styles.pending}>
            Profiller, konumlar, bildirimler ve asistan durumu buraya gelecek.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SignedIn({ email }: { email: string }) {
  const signOut = useAuth((state) => state.signOut);
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    setBusy(true);
    // `signOut` clears the local session whatever the server says, so there is no failure
    // path to render here — only the moment it takes.
    await signOut();
    setBusy(false);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Hesap</Text>
      <Text style={styles.email}>{email}</Text>
      <Text style={styles.note}>
        Profillerin ve konumların bu hesaba kayıtlı. Uygulamayı silip kursan da duruyorlar.
      </Text>
      <Pressable
        onPress={leave}
        disabled={busy}
        style={[styles.secondary, busy && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>{busy ? "Çıkılıyor…" : "Çıkış yap"}</Text>
      </Pressable>
    </View>
  );
}

function SignedOut() {
  const signIn = useAuth((state) => state.signIn);
  const signUp = useAuth((state) => state.signUp);

  const [mode, setMode] = useState<"in" | "up">("in");
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
    } catch (error) {
      setFailure(describe(error, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.label}>Misafirsin</Text>
        <Text style={styles.note}>
          Her şey hesapsız da çalışıyor ve hiçbir şey cihazından çıkmıyor. Hesap açarsan
          profillerin ve konumların sunucuna kaydolur, ikinci cihazından da açılır.
        </Text>
      </View>

      <View style={styles.tabs}>
        <Tab label="Giriş yap" active={mode === "in"} onPress={() => setMode("in")} />
        <Tab label="Hesap aç" active={mode === "up"} onPress={() => setMode("up")} />
      </View>

      <View style={styles.form}>
        <Field
          label="E-posta"
          value={email}
          onChange={setEmail}
          placeholder="ornek@site.com"
          keyboardType="email-address"
          autoComplete="email"
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
          // Said while typing rather than after submitting: docs/10 wants a control to
          // say what will happen, and a length rule the person only learns by failing is
          // the opposite of that.
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
      </View>
    </View>
  );
}

/**
 * A failure, in words a person can act on.
 *
 * The server deliberately refuses to say whether an address exists (docs/07), so the
 * wrong-credentials message covers both cases and must not imply otherwise — "böyle bir
 * hesap yok" would leak exactly what the endpoint is careful not to.
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
      style={[styles.tab, active && styles.tabOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  ...input
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  // `onChange` is omitted deliberately: TextInput has one of its own that takes an
  // event, and spreading both leaves a prop that must satisfy two incompatible shapes.
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
  safe: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg },

  header: { paddingTop: space.sm, paddingBottom: space.xs, gap: space.xs },
  eyebrow: { ...type.label, color: colors.inkDim },
  title: { ...type.display, fontSize: size.title, color: colors.ink },

  restoring: { paddingVertical: space.xl, alignItems: "center" },
  stack: { gap: space.lg },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    borderLeftWidth: 2,
    borderLeftColor: colors.burn,
    padding: space.md,
    gap: space.sm,
  },
  label: { ...type.label, color: colors.burnHi },
  email: { ...type.data, fontSize: size.body, color: colors.ink },
  note: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },

  tabs: { flexDirection: "row", gap: space.sm },
  tab: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  tabOn: { backgroundColor: colors.burnWash, borderColor: colors.burn },
  tabText: { ...type.label, color: colors.inkDim },
  tabTextOn: { color: colors.burnHi },

  form: { gap: space.md },
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

  primary: {
    alignItems: "center",
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.burnWash,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.burn,
  },
  primaryText: { ...type.label, color: colors.burnHi },
  secondary: {
    alignSelf: "flex-start",
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  secondaryText: { ...type.label, color: colors.ink2 },
  dim: { opacity: 0.4 },

  pending: { ...type.body, fontSize: 12, lineHeight: 18, color: colors.inkDim },
});
