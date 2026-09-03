/**
 * Sen — the account, and eventually everything attached to it.
 *
 * This screen used to carry the sign-in form itself. It is a row that opens the gate now:
 * signing in is a decision about the whole app, not a setting, and burying the form under
 * a settings heading made the most consequential choice in the product look like a
 * preference. The gate says what an account is for; this only says where you stand.
 *
 * Profiles, locations, notifications and the assistant's status still belong here
 * (docs/11) and are not built.
 */

import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { colors, radius, size, space, type } from "@/theme";

export function YouScreen() {
  const status = useAuth((state) => state.status);
  const account = useAuth((state) => state.account);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
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
          <Guest />
        )}

        <Text style={styles.pending}>
          Profiller, konumlar, bildirimler ve asistan durumu buraya gelecek.
        </Text>
      </ScrollView>
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
        style={[styles.action, busy && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>{busy ? "Çıkılıyor…" : "Çıkış yap"}</Text>
      </Pressable>
    </View>
  );
}

function Guest() {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Misafirsin</Text>
      <Text style={styles.note}>
        Her şey çalışıyor ve hiçbir şey cihazından çıkmıyor. Hesap açarsan profillerin ve
        konumların sunucuna kaydolur, ikinci cihazından da açılır.
      </Text>
      <Pressable
        onPress={() => router.push("/welcome")}
        style={styles.action}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>Hesap aç veya giriş yap</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ground },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg },

  header: { paddingTop: space.sm, paddingBottom: space.xs, gap: space.xs },
  eyebrow: { ...type.label, color: colors.inkDim },
  title: { ...type.display, fontSize: size.title, color: colors.ink },

  restoring: { paddingVertical: space.xl, alignItems: "center" },

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

  action: {
    alignSelf: "flex-start",
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  actionText: { ...type.label, color: colors.ink2 },
  dim: { opacity: 0.4 },

  pending: { ...type.body, fontSize: 12, lineHeight: 18, color: colors.inkDim },
});
