/**
 * Text that stays readable on whatever the sky is doing behind it.
 *
 * Measured before it was built: at 14:00 the app's bone-white ink drops to 2.05 against
 * the midday gradient — below the 3.0 that even large text is meant to clear, which is
 * why some labels were simply not visible. The full numbers are in `lib/sky.ts`.
 *
 * Each block asks about **its own position** rather than the screen taking one decision.
 * That is not fussiness: the gradient runs from a dark top to a light middle and back to
 * the app's ground, so at midday the header and the trace legend want opposite inks at the
 * same moment. A single screen-wide choice is wrong for one of them by construction.
 *
 * `onLayout` rather than a hardcoded depth, so this keeps working when the layout above it
 * changes — which it will.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from "react-native";

import { inkOn, skyAt, NIGHT_INK, type Ink } from "@/lib/sky";

type SkyState = {
  localHour: number;
  cloudCoverPct: number;
  /**
   * How far the content has scrolled under the sky.
   *
   * `onLayout` reports a position in the scroll view's *content*, while the atmosphere is
   * pinned to the screen — so a block that has scrolled up is over a different part of the
   * gradient than its layout says. Without this, scrolling the verdict into the dark top
   * would leave it in day ink on a night sky: the exact failure this whole file exists to
   * remove, reintroduced by a gesture.
   */
  scrollY: number;
};

/** What the atmosphere is currently drawing. Null on screens that have no sky. */
const SkyContext = createContext<SkyState | null>(null);

export function SkyProvider({ value, children }: { value: SkyState; children: ReactNode }) {
  return <SkyContext.Provider value={value}>{children}</SkyContext.Provider>;
}

const InkContext = createContext<Ink>(NIGHT_INK);

/** The ink for wherever the caller is. Night by default, which is the app's own ground. */
export function useInk(): Ink {
  return useContext(InkContext);
}

export function Legible({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const sky = useContext(SkyContext);
  const { height } = useWindowDimensions();
  const [centre, setCentre] = useState<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height: own } = event.nativeEvent.layout;
    // The middle of the block, because that is where most of its text is. Measuring the
    // top would flip a tall block early and the bottom would flip it late.
    const next = y + own / 2;
    setCentre((current) => (current === next ? current : next));
  };

  const ink =
    sky === null || centre === null
      ? NIGHT_INK
      : inkOn(skyAt(sky.localHour, sky.cloudCoverPct, (centre - sky.scrollY) / height));

  return (
    <InkContext.Provider value={ink}>
      <View style={style} onLayout={onLayout}>
        {children}
      </View>
    </InkContext.Provider>
  );
}


/**
 * Scroll position, quantised.
 *
 * Reported in 40px steps rather than every frame. The ink only ever takes one of two
 * values, so a pixel-accurate offset would re-render the screen sixty times a second to
 * produce the same answer; forty is finer than the band either ink is wrong in and coarse
 * enough that a full-screen scroll costs about twenty renders.
 */
export const SCROLL_STEP = 40;

export function quantiseScroll(offset: number): number {
  return Math.round(offset / SCROLL_STEP) * SCROLL_STEP;
}
