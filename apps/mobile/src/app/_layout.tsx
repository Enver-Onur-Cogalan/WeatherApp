import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  useFonts,
} from "@expo-google-fonts/archivo";
import { ArchivoBlack_400Regular } from "@expo-google-fonts/archivo-black";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

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
    if ((ready || error) && status !== "restoring") SplashScreen.hideAsync();
  }, [ready, error, status]);

  if (!ready && !error) return null;

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
