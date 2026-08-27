import { ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import AppTabs from "@/components/app-tabs";
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
    regular: { fontFamily: "System", fontWeight: "400" as const },
    medium: { fontFamily: "System", fontWeight: "500" as const },
    bold: { fontFamily: "System", fontWeight: "700" as const },
    heavy: { fontFamily: "System", fontWeight: "800" as const },
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={instrumentTheme}>
      <StatusBar style="light" />
      <AppTabs />
    </ThemeProvider>
  );
}
