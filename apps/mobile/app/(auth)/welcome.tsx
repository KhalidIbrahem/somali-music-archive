/**
 * Welcome / onboarding (ARCHITECTURE.md §7 "Welcome / Onboarding").
 *
 * Three horizontally-paged slides driven by React Native Reanimated v3:
 *   1. The five-pointed geometric star animates outward from the centre — the
 *      identity moment — under a bilingual (Somali + English) tagline.
 *   2. An animated oud waveform + the three pillars: Archive, Learn, Discover.
 *   3. The calls to action: Create account / Sign in.
 *
 * Amber pagination dots track progress; a Skip button (slides 1–2) jumps to the
 * CTA slide. Layout is width-driven so it scales from iPhone SE to iPad.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Button, Text } from '@/components/ui';
import { GeometricStar } from '@/components/auth/GeometricStar';
import { colors, spacing } from '@/theme';

const SLIDE_COUNT = 3;
const WAVE_BARS = 28;

export default function Welcome(): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const [index, setIndex] = useState(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const goToSlide = (i: number): void => {
    scrollRef.current?.scrollTo({ x: width * i, animated: true });
  };

  const starSize = Math.min(width * 0.55, 240);

  return (
    <View style={styles.container}>
      {/* Skip — hidden on the final CTA slide. */}
      {index < SLIDE_COUNT - 1 ? (
        <Pressable
          style={[styles.skip, { top: insets.top + spacing.sm }]}
          onPress={() => goToSlide(SLIDE_COUNT - 1)}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
          hitSlop={12}
        >
          <Text variant="labelLarge" color="secondary">
            Skip
          </Text>
        </Pressable>
      ) : null}

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {/* ── Slide 1 — the star ─────────────────────────────────────────── */}
        <Slide width={width} height={height}>
          <StarHero size={starSize} />
          <View style={styles.tagline}>
            <Text variant="displayMedium" color="accent" style={styles.center}>
              Muusigga Awoowayaasha
            </Text>
            <Text variant="displaySmall" style={styles.center}>
              The Music of Our Ancestors
            </Text>
          </View>
        </Slide>

        {/* ── Slide 2 — waveform + pillars ───────────────────────────────── */}
        <Slide width={width} height={height}>
          <Waveform width={Math.min(width - spacing.xxl * 2, 440)} />
          <Text variant="displaySmall" color="primary" style={[styles.center, styles.slide2Text]}>
            5,000 years of Somali musical tradition. Preserved. Taught. Shared.
          </Text>
          <View style={styles.pillars}>
            <Pillar icon="albums-outline" label="Archive" />
            <Pillar icon="school-outline" label="Learn" />
            <Pillar icon="compass-outline" label="Discover" />
          </View>
        </Slide>

        {/* ── Slide 3 — calls to action ──────────────────────────────────── */}
        <Slide width={width} height={height}>
          <View style={styles.ctaHeader}>
            <GeometricStar size={starSize * 0.5} />
            <Text variant="displayMedium" color="accent" style={styles.center}>
              Join the archive
            </Text>
            <Text variant="bodyLarge" color="secondary" style={styles.center}>
              Connect with the music of Somali families around the world.
            </Text>
          </View>
          <View style={[styles.ctaActions, { paddingBottom: insets.bottom + spacing.xl }]}>
            <Link href="/(auth)/register" asChild>
              <Button label="Create account" />
            </Link>
            <Link href="/(auth)/login" asChild>
              <Button label="Sign in" variant="ghost" />
            </Link>
          </View>
        </Slide>
      </Animated.ScrollView>

      {/* Pagination dots. */}
      <View style={[styles.dots, { bottom: insets.bottom + spacing.xxxl }]} pointerEvents="none">
        {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
          <Dot key={i} index={i} scrollX={scrollX} width={width} />
        ))}
      </View>
    </View>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────────

function Slide({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return <View style={[styles.slide, { width, height }]}>{children}</View>;
}

/** Slide-1 star: scales up from the centre with a gentle perpetual rotation. */
function StarHero({ size }: { size: number }): React.JSX.Element {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(
      150,
      withTiming(1, { duration: 950, easing: Easing.out(Easing.back(1.4)) }),
    );
    opacity.value = withDelay(150, withTiming(1, { duration: 950 }));
    spin.value = withRepeat(withTiming(1, { duration: 60_000, easing: Easing.linear }), -1, false);
  }, [scale, opacity, spin]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <Animated.View style={style}>
      <GeometricStar size={size} />
    </Animated.View>
  );
}

/** An animated bar in the oud waveform. */
function WaveBar({ index }: { index: number }): React.JSX.Element {
  const level = useSharedValue(0.25);

  useEffect(() => {
    level.value = withDelay(
      index * 60,
      withRepeat(
        withTiming(1, { duration: 620 + (index % 5) * 130, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
  }, [level, index]);

  const style = useAnimatedStyle(() => ({ height: `${18 + level.value * 82}%` }));
  return <Animated.View style={[styles.waveBar, style]} />;
}

function Waveform({ width }: { width: number }): React.JSX.Element {
  return (
    <View style={[styles.waveform, { width }]}>
      {Array.from({ length: WAVE_BARS }).map((_, i) => (
        <WaveBar key={i} index={i} />
      ))}
    </View>
  );
}

function Pillar({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}): React.JSX.Element {
  return (
    <View style={styles.pillar}>
      <View style={styles.pillarIcon}>
        <Ionicons name={icon} size={24} color={colors.amber.primary} />
      </View>
      <Text variant="labelLarge" color="secondary">
        {label}
      </Text>
    </View>
  );
}

/** A pagination dot that widens and brightens as its slide becomes active. */
function Dot({
  index,
  scrollX,
  width,
}: {
  index: number;
  scrollX: SharedValue<number>;
  width: number;
}): React.JSX.Element {
  const style = useAnimatedStyle(() => {
    const input = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(scrollX.value, input, [8, 22, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, input, [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  skip: {
    position: 'absolute',
    right: spacing.base,
    zIndex: 10,
    padding: spacing.sm,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
  tagline: {
    gap: spacing.sm,
    maxWidth: 460,
  },
  slide2Text: {
    maxWidth: 420,
  },
  waveform: {
    height: 120,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 3,
  },
  waveBar: {
    flex: 1,
    backgroundColor: colors.amber.primary,
    borderRadius: 999,
    minHeight: 4,
  },
  pillars: {
    flexDirection: 'row',
    gap: spacing.xxl,
  },
  pillar: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  pillarIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.secondary,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  ctaHeader: {
    alignItems: 'center',
    gap: spacing.base,
    maxWidth: 460,
  },
  ctaActions: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: 0,
    gap: spacing.sm,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber.primary,
  },
});
