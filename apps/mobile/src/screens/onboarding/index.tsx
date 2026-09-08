/**
 * The tour.
 *
 * Three cards on a turning drum, shown once after the gate and reachable again from Sen.
 *
 * **It explains the product, not the furniture.** The first version named the three tabs,
 * which is the one thing a person finds in two taps — a tour that describes the navigation
 * has spent someone's attention on the least valuable thing it knows. What actually needs
 * saying is that the line on the main screen is *not temperature*: it is how well each
 * hour suits what you want to do. Nobody discovers that by tapping.
 *
 * It also stopped talking about the server. "The model runs on your own server" is an
 * architecture sentence in a place reserved for a person's reasons; what is left of it
 * that they can use is that nothing they ask leaves the phone.
 *
 * **Why cards rather than pages.** Full-width pages hide their neighbours, so the tour
 * had no shape — you could not see that there were three of anything until you reached
 * the end. Narrower cards with the next one showing at the edge say "there is more, and
 * it is that way" without a single word, and they give the drum something to be made of.
 */

import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { BurnIn } from "@/components/burn-in";
import { Button } from "@/components/controls";
import { TourCard, type Face } from "@/components/tour-card";
import { useCopy } from "@/lib/i18n";
import { useTour } from "@/lib/onboarding";
import { colors, radius, space, type } from "@/theme";

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

/**
 * One mark per card, in the order the product works in: a day's shape, the limits that
 * pick hours out of it, and the answer that comes back.
 */
const FACES: Face[] = ["trace", "limits", "window"];

/** How much of the screen a card takes. The rest is the next card, showing. */
const CARD_FRACTION = 0.78;

/**
 * How far a card turns as it leaves.
 *
 * A three-sided drum steps 120° between faces and that is what this is a view of — but
 * the whole 120° is also what makes a neighbour invisible, because a face past ninety is
 * edge-on and then facing away. What a person actually sees of a prism is the front face
 * and two others foreshortened, which is this: turned hard enough to be clearly a face of
 * something, not so hard that the card beside you disappears.
 */
const TURN = 62;

/** Distance to the eye. Smaller is a more violent perspective; this is a drum an arm away. */
const EYE = 900;

export function OnboardingScreen() {
  const copy = useCopy();
  const markSeen = useTour((state) => state.markSeen);
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);

  const [page, setPage] = useState(0);
  const pages = copy.tour.pages;
  const last = page === pages.length - 1;

  const cardWidth = Math.round(width * CARD_FRACTION);
  // One card plus the gap between them: the distance the drum turns by one face.
  const step = cardWidth + space.md;
  // What centres the first and last card rather than leaving them against an edge.
  const inset = (width - cardWidth) / 2;

  // Continuous, in cards rather than pixels, so the drum can track the finger.
  const progress = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    progress.set(event.contentOffset.x / Math.max(1, step));
  });

  const leave = () => {
    markSeen();
    // Reached from Sen there is an app behind this; on first launch there is not.
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const advance = () => {
    if (last) return leave();
    scroller.current?.scrollTo({ x: (page + 1) * step, animated: true });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
        <View style={styles.skipRow}>
          {/* Gone on the last card: the primary button already says the same thing, and
              two ways to finish reads as indecision. */}
          {last ? null : (
            <Pressable onPress={leave} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>{copy.tour.skip}</Text>
            </Pressable>
          )}
        </View>

        <AnimatedScrollView
          ref={scroller}
          horizontal
          // Not `pagingEnabled`: that snaps by the width of the screen, and these are
          // narrower than it. Snapping by the card's own step is what keeps a card
          // centred with its neighbours showing either side.
          snapToInterval={step}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(event) =>
            setPage(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, step)))
          }
          contentContainerStyle={{ paddingHorizontal: inset, gap: space.md }}
          style={styles.fill}
        >
          {pages.map((item, index) => (
            <Card
              key={item.title}
              face={FACES[index]}
              title={item.title}
              body={item.body}
              index={index}
              cardWidth={cardWidth}
              progress={progress}
              lit={page === index}
            />
          ))}
        </AnimatedScrollView>

        <View style={styles.foot}>
          <View
            style={styles.marks}
            accessibilityRole="progressbar"
            accessibilityLabel={copy.tour.step(page + 1, pages.length)}
          >
            {pages.map((item, index) => (
              <Mark key={item.title} index={index} progress={progress} />
            ))}
          </View>

          <Button label={last ? copy.tour.start : copy.tour.next} onPress={advance} />
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * One card, and one face of the drum.
 *
 * The drawing, the name and the sentence travel together because they are one object —
 * an earlier version moved them at three different rates, which was a nice effect and
 * the wrong idea: it made a card look like three things that happened to be near each
 * other. What turns is the card.
 */
function Card({
  face,
  title,
  body,
  index,
  cardWidth,
  progress,
  lit,
}: {
  face: Face;
  title: string;
  body: string;
  index: number;
  cardWidth: number;
  progress: { get: () => number };
  /** True once this card is the one being read, which is when its title burns. */
  lit: boolean;
}) {
  const drum = useAnimatedStyle(() => {
    // How far this card is from the middle of the screen, in cards. Zero when it is here.
    const away = progress.get() - index;
    const held = away < -1 ? -1 : away > 1 ? 1 : away;
    return {
      transform: [
        { perspective: EYE },
        { rotateY: `${-held * TURN}deg` },
        // A face turning away that stayed the same size would read as a flat card doing
        // a trick rather than as a side of something.
        { scale: 1 - Math.abs(held) * 0.08 },
      ],
      opacity: 1 - Math.abs(held) * 0.55,
    };
  });

  return (
    <Animated.View style={[styles.face, { width: cardWidth }, drum]}>
      <TourCard face={face} lit={lit} />
      <BurnIn text={title} size={30} active={lit} duration={700} />
      <Text style={styles.body} accessibilityLabel={`${title}. ${body}`}>
        {body}
      </Text>
    </Animated.View>
  );
}

/**
 * One segment of the card, scorched as far as the drum has turned.
 *
 * A ruled bar that the burn fills, rather than a dot that changes colour — the same mark
 * the week cards and the recorder use, at the smallest size it still reads at.
 */
function Mark({ index, progress }: { index: number; progress: { get: () => number } }) {
  // Width on an absolutely positioned, childless fill — the one layout property the
  // animation guidance exempts, because it is out of flow so nothing else re-lays-out,
  // and because `scaleX` would smear the rounded end.
  const fill = useAnimatedStyle(() => {
    const at = progress.get() - index;
    const clamped = at < 0 ? 0 : at > 1 ? 1 : at;
    return { width: `${clamped * 100}%` };
  });

  return (
    <View style={styles.mark}>
      <Animated.View style={[styles.markFill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  fill: { flex: 1 },

  skipRow: {
    height: 40,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: space.lg,
  },
  skip: { ...type.label, color: colors.inkDim },

  // The back of a card is not a thing this instrument has. Without this, a face turned
  // past ninety degrees shows a mirrored version of itself.
  face: {
    backfaceVisibility: "hidden",
    justifyContent: "center",
    gap: space.lg,
    paddingVertical: space.lg,
  },
  body: { ...type.body, fontSize: 15, lineHeight: 24, color: colors.ink2 },

  foot: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg },
  marks: { flexDirection: "row", gap: space.xs },
  mark: {
    flex: 1,
    height: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.ruleSoft,
    overflow: "hidden",
  },
  markFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.burn,
    borderRadius: radius.sm,
  },
});
