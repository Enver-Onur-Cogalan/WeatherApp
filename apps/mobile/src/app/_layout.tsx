import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  useFonts,
} from "@expo-google-fonts/archivo";
import { ArchivoBlack_400Regular } from "@expo-google-fonts/archivo-black";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { Tabs, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { TabBar } from "@/components/tab-bar";
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
  const [ready, error] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    ArchivoBlack_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    // Hide once the faces are resolved, either way. Holding the splash screen on a
    // font error would trade a fallback face for a permanently blank app.
    if (ready || error) SplashScreen.hideAsync();
  }, [ready, error]);

  if (!ready && !error) return null;

  return (
    // Gestures do nothing at all without this, and they fail silently.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={instrumentTheme}>
          <StatusBar style="light" />
          <Tabs
            tabBar={(props) => <TabBar {...props} />}
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: colors.ground },
              // Tabs are peers, not a hierarchy — sliding between them implies a depth
              // that is not there, and the user pays for it dozens of times a session.
              animation: "none",
            }}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
