import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  useFonts,
} from "@expo-google-fonts/archivo";
import { ArchivoBlack_400Regular } from "@expo-google-fonts/archivo-black";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { db } from "@/db/client";
import migrations from "@/db/migrations";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queries";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync();

/**
 * The app commits to one visual world (docs/10), so there is no light theme to switch
 * to — daylight arrives through the atmosphere layer instead.
 */
const instrumentTheme = {
  dark: true,
  colors: {
    primary: colors.burnHi,
    background: colors.ground,
    card: colors.ground2,
    text: colors.ink,
    border: colors.rule,
    notification: colors.ember,
  },
  fonts: {
    regular: { fontFamily: "Archivo_400Regular", fontWeight: "400" as const },
    medium: { fontFamily: "Archivo_600SemiBold", fontWeight: "600" as const },
    bold: { fontFamily: "ArchivoBlack_400Regular", fontWeight: "700" as const },
    heavy: { fontFamily: "ArchivoBlack_400Regular", fontWeight: "900" as const },
  },
};

export default function RootLayout() {
  const restore = useAuth((state) => state.restore);
  const status = useAuth((state) => state.status);

  // Before the first query, always (docs/12). `success` gates rendering rather than the
  // splash alone: a screen that queries a table a migration has not created yet fails at
  // the driver, which is a long way from anything that reads like a cause.
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);

  // Once, at launch. A stored refresh token is spent on a real refresh before the app
  // claims to be signed in — see `lib/auth.ts`. Failing that we are a guest, which is a
  // working state rather than an error, so nothing here waits on it.
  useEffect(() => {
    void restore();
  }, [restore]);

  const [ready, error] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    ArchivoBlack_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    // Held until the fonts are resolved *and* the session is known. Hiding it earlier
    // shows a blank frame — the tabs render nothing while `restoring`, because guessing
    // would flash a sign-in screen at someone who is already signed in.
    //
    // Fonts resolve either way on purpose: holding the splash on a font error would
    // trade a fallback face for a permanently blank app.
    if ((ready || error) && status !== "restoring" && (migrated || migrationError)) {
      SplashScreen.hideAsync();
    }
  }, [ready, error, status, migrated, migrationError]);

  if (!ready && !error) return null;

  // A failed migration is the one storage error worth stopping for. Carrying on would
  // mean every screen failing separately, in the driver's words rather than ours.
  if (migrationError) return <StorageFailure error={migrationError} />;
  if (!migrated) return null;

  return (
    // Gestures do nothing at all without this, and they fail silently.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={instrumentTheme}>
          <StatusBar style="light" />
          {/* A stack, so the gate can exist outside the tab bar. Every file directly in
              `app/` becomes a tab otherwise, and a sign-in screen is not a peer of the
              forecast. */}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.ground },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The device database could not be brought up to date.
 *
 * Deliberately plain and deliberately terminal. docs/12 says a device migration must be
 * idempotent and must never destroy user-owned data — which means when one fails there is
 * nothing safe to do automatically, because the safe repair (drop and rebuild) is exactly
 * what would throw away the profiles the rule exists to protect.
 */
function StorageFailure({ error }: { error: Error }) {
  return (
    <View style={failureStyles.root}>
      <Text style={failureStyles.title}>Cihaz veritabanı açılamadı</Text>
      <Text style={failureStyles.detail}>
        Uygulama yerel kaydını güncelleyemedi. Kayıtlı profillerini kaybetmemek için
        kendiliğinden onarmıyoruz — uygulamayı silip yeniden kurmak sorunu çözer ama yerel
        profilleri de siler.
      </Text>
      <Text style={failureStyles.technical}>{error.message}</Text>
    </View>
  );
}

const failureStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground, padding: 24, justifyContent: "center", gap: 12 },
  title: { fontFamily: "IBMPlexMono_500Medium", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: colors.ember },
  detail: { fontFamily: "Archivo_400Regular", fontSize: 15, lineHeight: 22, color: colors.ink2 },
  technical: { fontFamily: "IBMPlexMono_500Medium", fontSize: 11, lineHeight: 16, color: colors.inkDim },
});
