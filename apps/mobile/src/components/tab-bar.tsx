/**
 * The tab bar.
 *
 * docs/02 says native where a control would only say "we styled this ourselves", and a
 * tab bar has no thesis — so this started as `NativeTabs`. It came back twice as too
 * tall: Material 3's navigation bar is 80dp of another design language sitting under a
 * screen built on hairlines, and `NativeTabs` exposes no height. `labelVisibilityMode`
 * trimmed it and not enough.
 *
 * So the rule gains a third case: **native unless the platform default is materially
 * wrong for the design and the component offers no way to adjust it.** That is a real
 * cost, not a free win — the platform's ripple, translucency and its own accessibility
 * handling all become ours to reproduce, and the roles and states below are that debt
 * being paid rather than decoration.
 */

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
// expo-router bundles its own copy of React Navigation, so the props type comes from
// there. Importing `@react-navigation/bottom-tabs` directly would resolve to a package
// this project does not depend on.
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space, type } from "@/theme";

const BAR_HEIGHT = 46;
const ICON_SIZE = 21;

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TABS: Record<string, { label: string; icon: IconName; active: IconName }> = {
  index: { label: "İz", icon: "chart-timeline-variant", active: "chart-timeline-variant" },
  ask: { label: "Sor", icon: "message-outline", active: "message" },
  you: { label: "Sen", icon: "account-outline", active: "account" },
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: BAR_HEIGHT + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;

        const focused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          // Respecting `preventDefault` is what keeps a screen able to intercept its own
          // tab press — scroll-to-top, or discarding a draft before leaving.
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
          >
            {/* The burn mark, where the instrument marks anything that matters. */}
            <View style={[styles.mark, focused && styles.markOn]} />
            <MaterialCommunityIcons
              name={focused ? tab.active : tab.icon}
              size={ICON_SIZE}
              color={focused ? colors.burnHi : colors.inkDim}
            />
            <Text style={[styles.label, focused && styles.labelOn]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.ground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingTop: space.xs,
  },
  // Always laid out, only ever coloured — so nothing shifts when the tab changes.
  mark: {
    position: "absolute",
    top: 0,
    width: 18,
    height: 2,
    backgroundColor: "transparent",
  },
  markOn: { backgroundColor: colors.burn },
  label: { ...type.label, fontSize: 8, color: colors.inkDim },
  labelOn: { color: colors.ink },
});
