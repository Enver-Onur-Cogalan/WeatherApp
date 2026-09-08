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

import { LanguagePicker } from "@/components/language-picker";
import { useCopy } from "@/lib/i18n";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { moveProfilesToAccount, pendingProfiles } from "@/db/handoff";
import { useAuth } from "@/lib/auth";
import { Places } from "@/components/places";
import { Profiles } from "@/screens/you/profiles";
import { colors, radius, size, space, type } from "@/theme";

export function YouScreen() {
  const copy = useCopy();
  const status = useAuth((state) => state.status);
  const account = useAuth((state) => state.account);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{copy.you.settings}</Text>
          <Text style={styles.title}>{copy.you.title}</Text>
        </View>

        {status === "restoring" ? (
          <View style={styles.restoring}>
            <ActivityIndicator color={colors.burnHi} size="small" />
          </View>
        ) : status === "signed-in" && account !== null ? (
          <>
            <SignedIn email={account.email} />
            {/* The offer, if it was declined at sign-in or half of it failed. Declining
                has to be a real answer, which means it cannot be a one-time prompt that
                disappears — this is where it waits. */}
            <Handoff userId={account.id} />
          </>
        ) : (
          <Guest />
        )}

        {/* Profiles belong to a person whether or not that person has an account. A
            guest's live in SQLite on the device; an account's live on the server. The
            screen is the same either way, which is what stops the two paths drifting. */}
        {status !== "restoring" ? (
          <>
            <Profiles />
            <View style={styles.card}>
              <Text style={styles.label}>{copy.you.places}</Text>
              <Places />
            </View>
            <LanguagePicker />
            <Tour />
          </>
        ) : null}

        <Text style={styles.pending}>{copy.you.pending}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SignedIn({ email }: { email: string }) {
  const copy = useCopy();
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
      <Text style={styles.label}>{copy.you.account}</Text>
      <Text style={styles.email}>{email}</Text>
      <Text style={styles.note}>{copy.you.signedIn}</Text>
      <Pressable
        onPress={leave}
        disabled={busy}
        style={[styles.action, busy && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>
          {busy ? copy.you.signingOut : copy.you.signOut}
        </Text>
      </Pressable>
    </View>
  );
}

function Handoff({ userId }: { userId: string }) {
  const copy = useCopy();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = () => void pendingProfiles().then((rows) => setCount(rows.length));
  useEffect(refresh, []);

  if (count === 0) return null;

  const move = async () => {
    setBusy(true);
    await moveProfilesToAccount(userId);
    refresh();
    setBusy(false);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{copy.you.unmovedLabel}</Text>
      <Text style={styles.note}>{copy.you.unmoved(count)}</Text>
      <Pressable
        onPress={move}
        disabled={busy}
        style={[styles.action, busy && styles.dim]}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>
          {busy ? copy.you.moving : copy.you.moveToAccount}
        </Text>
      </Pressable>
    </View>
  );
}

function Guest() {
  const copy = useCopy();
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{copy.you.guestLabel}</Text>
      <Text style={styles.note}>{copy.you.guest}</Text>
      <Pressable
        onPress={() => router.push("/welcome")}
        style={styles.action}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>{copy.you.signInOrUp}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The tour, again.
 *
 * It runs once on first launch, which means the one explanation of what the trace's
 * vertical axis *is* happens at the moment somebody is least interested in reading it.
 * Making it repeatable costs one row and removes the need to get that moment right.
 */
function Tour() {
  const copy = useCopy();

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => router.push("/onboarding")}
        style={styles.action}
        accessibilityRole="button"
      >
        <Text style={styles.actionText}>{copy.tour.again}</Text>
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
