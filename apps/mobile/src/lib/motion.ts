/**
 * The app's motion, in one place.
 *
 * Two rules from the Expo animation guidance, applied rather than restated at each call
 * site. Entrances and exits use a strong ease-out, because `ease-in` delays the exact
 * moment the eye is on the element. And **reduced motion ships with the animation**, not
 * afterwards — which here means opacity survives and translation does not, since the fade
 * still explains that something arrived while the movement is what causes trouble.
 *
 * Durations are deliberately short. docs/13 asked for the answer card to be *placed*
 * rather than to cut in; anything a person notices as an animation is too long for
 * something they will see dozens of times.
 */

import { Easing, FadeOut, FadeIn, ReduceMotion } from "react-native-reanimated";

/** Strong ease-out. Reanimated's built-in easings are as weak as CSS's. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * An element arriving where there was nothing.
 *
 * A fade with a small rise. Never `scale(0)` — nothing in the real world appears from
 * nothing, and the guidance is explicit about starting from 0.95 and up.
 */
export const arrive = () =>
  FadeIn.duration(220).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/**
 * An element leaving.
 *
 * Faster than the arrival: waiting for something you have already decided to remove reads
 * as lag rather than as polish.
 */
export const leave = () =>
  FadeOut.duration(140).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
