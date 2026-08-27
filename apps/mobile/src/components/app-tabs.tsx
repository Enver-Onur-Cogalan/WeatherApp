import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/theme";

/**
 * Three tabs, and everything else is one push deep (docs/11).
 *
 * Native tabs rather than a custom bar: a tab bar has no thesis, and platform
 * convention serves the user better than our opinion does. See docs/02.
 *
 * Icons are SF Symbols on iOS. Android shows labels until the icon set is designed —
 * docs/11 lists it as open, and a placeholder glyph would be worse than none.
 */
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={colors.ground2}
      indicatorColor={colors.burnWash}
      labelStyle={{ color: colors.inkDim, selected: { color: colors.ink } }}
      iconColor={colors.inkDim}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>İz</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "chart.xyaxis.line", selected: "chart.xyaxis.line" }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Sor</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Label>Sen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person", selected: "person.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
