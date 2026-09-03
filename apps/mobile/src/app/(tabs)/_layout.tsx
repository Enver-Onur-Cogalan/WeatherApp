import { Redirect, Tabs } from "expo-router";

import { TabBar } from "@/components/tab-bar";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme";

/**
 * The three tabs, behind the gate.
 *
 * The redirect lives here rather than in the root layout so that expo-router owns the
 * decision. Navigating imperatively from an effect races the first render — the tabs
 * mount, fetch, and are then torn down — whereas `<Redirect>` is evaluated before any of
 * that happens.
 *
 * `restoring` renders nothing on purpose. It lasts as long as one keystore read and one
 * refresh, and showing the gate during it would flash a sign-in screen at somebody who
 * is already signed in.
 */
export default function TabsLayout() {
  const status = useAuth((state) => state.status);
  const chosenGuest = useAuth((state) => state.chosenGuest);

  if (status === "restoring") return null;
  if (status === "guest" && !chosenGuest) return <Redirect href="/welcome" />;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ground },
        // Tabs are peers, not a hierarchy — sliding between them implies a depth that is
        // not there, and the user pays for it dozens of times a session.
        animation: "none",
      }}
    />
  );
}
