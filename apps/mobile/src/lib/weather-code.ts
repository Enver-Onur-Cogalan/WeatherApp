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

export type Condition =
  | "clear"
  | "partly"
  | "overcast"
  | "fog"
  | "light-rain"
  | "downpour"
  | "snow"
  | "hail"
  | "storm";

/** docs/12 holds the full table; this is the same mapping, in code. */
export function conditionFor(code: number): Condition {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code === 95) return "storm";
  if (code === 96 || code === 99) return "hail";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 66 || code === 67 || code === 82) return "downpour";
  if (code >= 51) return "light-rain";
  return "partly";
}

const LABELS: Record<Condition, string> = {
  clear: "Açık",
  partly: "Parçalı bulutlu",
  overcast: "Kapalı",
  fog: "Sisli",
  "light-rain": "Hafif yağmurlu",
  downpour: "Sağanak",
  snow: "Karlı",
  hail: "Dolu",
  storm: "Fırtınalı",
};

export function conditionLabel(code: number): string {
  return LABELS[conditionFor(code)];
}

/**
 * Whether a condition is worth colouring.
 *
 * Only the ones that change what a person would do — everything else stays in the
 * neutral ink so the accent keeps meaning "this is a window".
 */
export function isSevere(code: number): boolean {
  const condition = conditionFor(code);
  return condition === "storm" || condition === "hail" || condition === "downpour";
}
