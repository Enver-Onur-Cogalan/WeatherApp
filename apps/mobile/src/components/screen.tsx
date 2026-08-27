import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, size, space, type } from "@/theme";

/**
 * The shell every screen sits in: the ground colour, safe areas, and an eyebrow.
 *
 * Placeholder scaffolding while the screens are built — see docs/11 for what each one
 * will hold.
 */
export function Screen({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ground },
  content: { padding: space.lg, gap: space.sm },
  eyebrow: { ...type.label, color: colors.inkDim },
  title: { ...type.display, fontSize: size.verdict, color: colors.ink },
  body: { gap: space.md, marginTop: space.lg },
  note: { ...type.body, fontSize: size.body, color: colors.ink2, lineHeight: 22 },
});
