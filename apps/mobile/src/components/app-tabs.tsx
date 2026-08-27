import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { VectorIcon } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/theme";

/**
 * Three tabs, and everything else is one push deep (docs/11).
 *
 * Native tabs rather than a custom bar: a tab bar has no thesis, and platform
 * convention serves the user better than our opinion does (docs/02).
 *
 * Icons come from two sources on purpose. `sf` gives iOS its own SF Symbols, which are
 * sharper and match the system everywhere else; `src` carries a vector icon for
 * Android, where SF Symbols do not exist — the first build set only `sf` and Android
 * got a tab bar with no icons at all.
 *
 * `labelVisibilityMode: "selected"` labels only the active tab. On Android that trims a
 * Material 3 bar tall enough to fight a screen built around a hairline instrument.
 */
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={colors.ground2}
      indicatorColor={colors.burnWash}
      labelVisibilityMode="selected"
      labelStyle={{ color: colors.inkDim, selected: { color: colors.ink } }}
      iconColor={colors.inkDim}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>İz</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "chart.xyaxis.line", selected: "chart.xyaxis.line" }}
          src={<VectorIcon family={MaterialCommunityIcons} name="chart-timeline-variant" />}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Sor</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "bubble.left", selected: "bubble.left.fill" }}
          src={<VectorIcon family={MaterialCommunityIcons} name="message-outline" />}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Label>Sen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "person", selected: "person.fill" }}
          src={<VectorIcon family={MaterialCommunityIcons} name="account-outline" />}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
