/**
 * WMO weather codes into words.
 *
 * The mapping lives on the client because it is presentation: the server returns the
 * code, and the app decides what to call it in the language on screen. Sending a
 * translated string from the API would put Turkish in the contract and make the second
 * language a migration.
 *
 * The same codes select the atmosphere states in docs/10, which is why the field exists
 * at all — precipitation and cloud cover alone cannot tell snow from rain.
 */

import { copyFor, type Language } from "@/lib/i18n";

export type Condition =
  | "clear"
  | "partly"
  | "overcast"
  | "fog"
  | "light-rain"
  | "downpour"
  | "freezing"
  | "snow"
  | "hail"
  | "storm";

/** docs/12 holds the full table; this is the same mapping, in code. */
export function conditionFor(code: number): Condition {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  // Before the rain branches, because these codes are rain by any other reading — and
  // the one condition where the difference changes what a person should do. 56 and 57
  // are freezing drizzle, 66 and 67 freezing rain; all four used to be drawn, named and
  // scored as ordinary water.
  if (code === 56 || code === 57 || code === 66 || code === 67) return "freezing";
  if (code === 95) return "storm";
  if (code === 96 || code === 99) return "hail";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 82) return "downpour";
  if (code >= 51) return "light-rain";
  return "partly";
}

/**
 * What to call a condition, in the language the person chose.
 *
 * The names live in `i18n.ts` with the rest of the interface rather than here, because a
 * condition name is a word on a screen and not a property of a WMO code. This maps the
 * code; the dictionary supplies the word.
 */
export function conditionLabel(code: number, language: Language): string {
  return copyFor(language).weather[conditionFor(code)];
}

/**
 * Whether a condition is worth colouring.
 *
 * Only the ones that change what a person would do — everything else stays in the
 * neutral ink so the accent keeps meaning "this is a window".
 */
/**
 * Whether the sky is thundering, whatever is falling out of it.
 *
 * Thunder is not one of the conditions and should never have been asked for as one. The
 * condition names what *falls* — 96 and 99 are thunderstorms with hail, so their
 * condition is `hail`, which is correct — and the atmosphere layer asked
 * `condition === "storm"` when it wanted to know whether to draw lightning. It therefore
 * drew hail out of a silent sky on the two codes where the sky is loudest.
 */
export function hasThunder(code: number): boolean {
  return code === 95 || code === 96 || code === 99;
}

export function isSevere(code: number): boolean {
  const condition = conditionFor(code);
  return (
    condition === "storm" ||
    condition === "hail" ||
    condition === "downpour" ||
    // The most consequential of the set for someone deciding whether to go out, and the
    // last one to be told apart from ordinary rain.
    condition === "freezing"
  );
}
