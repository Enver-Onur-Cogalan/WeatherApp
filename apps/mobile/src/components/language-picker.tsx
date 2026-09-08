/**
 * The language the app and the assistant speak.
 *
 * It lives in Sen with the other things you set once. Two options and no third state: a
 * "system" setting would be a third thing to reason about, and the device's locale is
 * already what the first launch picks — this screen is where someone disagrees with it.
 *
 * The choice is not only cosmetic. It is sent with every question, and the server uses it
 * both to instruct the model and to *check* the answer it gets back (`right_language` in
 * `validation.py`). Before this existed the language was inferred from the question by a
 * word list and the model was merely asked to match it, which drifted — three Turkish
 * scenarios in a full evaluation run came back in English, and nothing could tell.
 */

import { Pressable, StyleSheet, Text, View } from "react-native";

import { copyFor, useCopy, useLanguage, useLanguageStore, type Language } from "@/lib/i18n";
import { colors, radius, size, space, type } from "@/theme";

const OPTIONS: Language[] = ["tr", "en"];

export function LanguagePicker() {
  const copy = useCopy();
  const language = useLanguage();
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{copy.you.language}</Text>

      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const active = option === language;
          return (
            <Pressable
              key={option}
              onPress={() => setLanguage(option)}
              style={[styles.option, active && styles.optionActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              {/* Each option is named in its own language, always. A person looking for
                  English should not have to find it under "İngilizce". */}
              <Text style={[styles.optionText, active && styles.optionTextActive]}>
                {copyFor(option).languageName}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.note}>{copy.you.languageHelp}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    backgroundColor: colors.surface,
  },
  label: { ...type.label, color: colors.inkDim },
  row: { flexDirection: "row", gap: space.xs },
  option: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  optionActive: { borderColor: colors.burn, backgroundColor: colors.burnWash },
  optionText: { ...type.body, fontSize: size.caption, color: colors.ink2 },
  optionTextActive: { color: colors.burnHi },
  note: { ...type.body, fontSize: size.caption, lineHeight: 20, color: colors.ink2 },
});
