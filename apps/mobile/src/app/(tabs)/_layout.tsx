import { Redirect, Tabs } from "expo-router";

import { TabBar } from "@/components/tab-bar";
import { useAuth } from "@/lib/auth";
import { useSelection } from "@/lib/locations";
import { useTour } from "@/lib/onboarding";
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
 * is already signed in. The tour's flag is read the same way and waited on for the same
 * reason.
 *
 * Order matters: the gate first, then the tour. The tour explains the three tabs, which
 * is not a useful thing to be told by an app you have not agreed to use yet.
 */
export default function TabsLayout() {
  const status = useAuth((state) => state.status);
  const chosenGuest = useAuth((state) => state.chosenGuest);
  const seenTour = useTour((state) => state.seen);
  // Waited on for the same reason: a screen that renders before the chosen place is known
  // falls back to the first saved one and fetches a forecast for it.
  const placeKnown = useSelection((state) => state.restored);

  if (status === "restoring" || seenTour === null || !placeKnown) return null;
  if (status === "guest" && !chosenGuest) return <Redirect href="/welcome" />;
  if (!seenTour) return <Redirect href="/onboarding" />;

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
