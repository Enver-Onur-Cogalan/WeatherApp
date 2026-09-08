/**
 * The buttons and fields the gate is built from.
 *
 * They live here rather than inside the screen because the gate is not the only place
 * they belong, and because the thing that was wrong with them was not one screen's
 * styling. Every control in the app was a `Pressable` with a border and no answer to
 * being touched — the app said nothing back, which on a phone is the whole of how an
 * interface feels built.
 *
 * Two ideas, both from the instrument.
 *
 * **A control reacts on press-in, not on release.** Waiting for the tap to finish before
 * showing anything is the latency a person actually perceives. The scale is small enough
 * to be felt rather than watched — 0.97 in 110ms — and it carries the label with it,
 * which is what makes it read as a physical object rather than a colour change.
 *
 * **Focus is an ignition.** A field's rule is a cold hairline until you touch it, and
 * then it takes the burn. It is the same event the recorder card draws: light arrives and
 * leaves a mark. Nothing else in the app uses that colour for a resting state, so a lit
 * rule can only mean "this is where you are typing".
 */

import * as Haptics from "expo-haptics";
import { forwardRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT } from "@/lib/motion";
import { colors, radius, size, space, type } from "@/theme";

const PRESS_MS = 110;
const PRESSED = 0.97;

type Variant =
  /** The one thing the screen wants you to do. Filled with the scorch. */
  | "primary"
  /** An equal alternative, drawn as ruling rather than as a mark. */
  | "secondary"
  /** A real choice that is not competing — never a link, per ADR-0009. */
  | "quiet";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Shown as its own word rather than a spinner: the label already has the room. */
  busy?: boolean;
}) {
  const reduced = useReducedMotion();
  const held = useSharedValue(0);

  const motion = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 - held.get() * (1 - PRESSED) }],
  }));

  const off = disabled || busy;

  return (
    <Animated.View style={motion}>
      <Pressable
        onPressIn={() => held.set(withTiming(1, { duration: PRESS_MS, easing: EASE_OUT }))}
        onPressOut={() => held.set(withTiming(0, { duration: PRESS_MS, easing: EASE_OUT }))}
        onPress={() => {
          if (off) return;
          // At the moment the choice commits, paired with the visual. A haptic is never
          // the only feedback — it is silent on most Android hardware and off entirely
          // for many people.
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        disabled={off}
        // A few pixels of drift should not cancel a press the person meant.
        pressRetentionOffset={12}
        style={[styles.base, styles[variant], off && styles.off]}
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy }}
      >
        <Text style={[styles.label, styles[`${variant}Text`]]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export const Field = forwardRef<TextInput, {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** Said under the field while it is true, not after a failed submit. */
  hint?: string | null;
} & Omit<TextInputProps, "value" | "onChange" | "style">>(function Field(
  { label, value, onChange, hint, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, focused && styles.fieldLabelOn]}>{label}</Text>

      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={colors.inkDim}
        selectionColor={colors.burnHi}
        style={[styles.input, focused && styles.inputOn]}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
      />

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  primary: { backgroundColor: colors.burn, borderColor: colors.burn },
  secondary: { backgroundColor: colors.surface, borderColor: colors.rule },
  quiet: { backgroundColor: "transparent", borderColor: colors.ruleSoft },
  off: { opacity: 0.45 },

  label: { ...type.heading, fontSize: size.caption, letterSpacing: 0.8 },
  primaryText: { color: colors.ground },
  secondaryText: { color: colors.ink },
  quietText: { color: colors.ink2 },

  field: { gap: space.xs },
  fieldLabel: { ...type.label, color: colors.inkDim },
  fieldLabelOn: { color: colors.burnHi },
  input: {
    ...type.body,
    fontSize: size.body,
    color: colors.ink,
    backgroundColor: colors.ground2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  inputOn: { borderColor: colors.burn, backgroundColor: colors.surface },
  hint: { ...type.body, fontSize: size.caption, lineHeight: 19, color: colors.ink2 },
});
