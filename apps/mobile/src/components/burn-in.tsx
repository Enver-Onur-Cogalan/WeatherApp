/**
 * The wordmark, scorched onto a recorder card.
 *
 * The gate is the one screen with no data on it, which is why it looked like a form with
 * a title. It needs a moment, and the app already owns one: a Campbell–Stokes recorder
 * focuses sunlight through a glass sphere and *burns* the sunny hours into a printed
 * card. Here the light writes the name instead.
 *
 * Two rules decided the shape of this, and both rule out the obvious version.
 *
 * **No weather.** [ADR-0013](../../../../docs/adr/ADR-0013-data-driven-atmosphere.md)
 * keeps the atmosphere layer only on the condition that it encodes real data. On this
 * screen there is no place, no forecast and possibly no server, so drawing a sky here
 * would be exactly the ornament that ADR refuses.
 *
 * **No trace.** `thinking.tsx` records why: a surface that draws the same curve the week
 * cards draw with real data stops reading as "the instrument is running" and starts
 * reading as "here is a day". Letterforms cannot be misread as a forecast. A curve can.
 *
 * So the ignition is the whole animation, and it happens once. A background that moves
 * forever would be decoration on a screen people sit on with the keyboard up, and it
 * would cost battery for it.
 */

import { Blur, Canvas, Group, Rect } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT } from "@/lib/motion";
import { colors, type } from "@/theme";

/**
 * Long enough to read as a pen crossing a card rather than a wipe transition.
 *
 * The week cards burn in 620ms across a card a fifth of this width. Matching their
 * *speed* rather than their duration is what makes the two read as the same instrument.
 */
const SWEEP_MS = 1100;

/** How far the hot point of focus reaches ahead of the scorch it is leaving. */
const GLOW_W = 26;

export function BurnIn({
  text,
  size,
  active = true,
  duration = SWEEP_MS,
}: {
  text: string;
  size: number;
  /**
   * Whether the light is on this card yet.
   *
   * The gate has one wordmark and burns it on mount. The tour has three titles side by
   * side in a pager, all mounted at once, and burning them together would mean the
   * animation had already happened by the time anyone swiped to it. Each page lights when
   * it arrives instead, which is what makes the swipe feel like it caused something.
   */
  active?: boolean;
  duration?: number;
}) {
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();

  // Complete from the start when motion is reduced. The screen is then the finished
  // card, which is the state the animation was heading for anyway — the guidance is
  // "fewer and gentler", not "start at nothing and stay there".
  const burnt = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced || width === 0 || !active) return;
    burnt.set(withTiming(1, { duration, easing: EASE_OUT }));
  }, [reduced, width, active, duration, burnt]);

  const measure = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    if (measured > 0 && measured !== width) setWidth(measured);
  };

  const scorch = useAnimatedStyle(() => ({ width: width * burnt.get() }));

  // The hot point sits at the leading edge and leaves with it. Fading it out over the
  // last of the sweep is what stops the animation ending on a bright dot.
  const glow = useAnimatedStyle(() => ({
    transform: [{ translateX: width * burnt.get() - GLOW_W / 2 }],
    opacity: burnt.get() >= 1 ? 0 : 1,
  }));

  const style = [styles.word, { fontSize: size, lineHeight: size * 1.06 }];

  return (
    <View style={styles.root}>
      {/* The card is printed before anything is written on it. The unburnt name is part
          of the ruling — visible, cold, and not yet a mark. */}
      <Text style={[...style, styles.unburnt]} onLayout={measure} allowFontScaling={false}>
        {text}
      </Text>

      <Animated.View style={[StyleSheet.absoluteFill, scorch, styles.clip]}>
        <Text style={[...style, styles.scorched]} allowFontScaling={false}>
          {text}
        </Text>
      </Animated.View>

      {width > 0 && !reduced ? (
        <Animated.View style={[styles.glow, glow]} pointerEvents="none">
          <Canvas style={{ width: GLOW_W, height: size * 1.4 }}>
            <Group>
              <Blur blur={9} />
              <Rect
                x={GLOW_W / 2 - 1.5}
                y={0}
                width={3}
                height={size * 1.4}
                color={colors.burnHi}
              />
            </Group>
          </Canvas>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: "flex-start" },
  word: { ...type.display, letterSpacing: 1.2 },
  unburnt: { color: colors.rule },
  scorched: { color: colors.burn },
  // `hidden` is what makes the reveal a clip rather than a resize: the text inside keeps
  // its full width and the container crops it.
  clip: { overflow: "hidden" },
  glow: { position: "absolute", top: "-14%", left: 0 },
});
