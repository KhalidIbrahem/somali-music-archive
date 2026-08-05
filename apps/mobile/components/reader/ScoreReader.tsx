/**
 * ScoreReader — mobile screen 5 (B1-08): the engraved sample session as a
 * READ-ONLY reader. Capture and reading happen on the phone; editing and the
 * inspector are desktop-only by product decision (§4).
 *
 * Pages are pre-rendered SVGs (confidence ink baked in by
 * scripts/build-sample-session.mjs) in a windowed FlatList. Pinch zooms
 * (1–2.5×), and during playback the list follows the sounding note — the same
 * one-cursor idea as the studio, driven by the audio player's own clock.
 * Manual scrolling pauses following; the follow chip re-enables it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Text } from 'react-native';
import { fontFamilies, spacing } from '@/theme';
import { TABULAR_NUMS } from '@/theme/studio';
import { useStudioTheme } from '@/theme/StudioThemeProvider';
import { activeNoteAt, followOffset } from './readerMath';
import audioSource from '@/assets/sample/audio.mp3';
import pagesData from '@/assets/sample/score-pages.json';
import notesData from '@/assets/sample/notes.json';

const PAGE_GAP = 12;
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ScoreReader(): React.JSX.Element {
  const { tokens } = useStudioTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<FlatList<string>>(null);
  const scrollYRef = useRef(0);
  const lastActiveRef = useRef<number | null>(null);

  const player = useAudioPlayer(audioSource);
  const status = useAudioPlayerStatus(player);

  const pageWidth = pagesData.width * zoom;
  const pageHeight = pagesData.height * zoom;
  const itemLength = pageHeight + PAGE_GAP * zoom;

  // Fit-to-width baseline: the page renders at screen width when zoom = 1.
  const fit = (width - spacing.base * 2) / pagesData.width;

  const commitZoom = useCallback((scale: number): void => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * scale)));
  }, []);

  const pinchScale = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      pinchScale.value = e.scale;
    })
    .onEnd(() => {
      runOnJS(commitZoom)(pinchScale.value);
      pinchScale.value = 1;
    });
  const pinchStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinchScale.value }],
  }));

  // ── follow the sounding note (one cursor, audio clock as truth) ────────────
  useEffect(() => {
    if (!follow || !status.playing) return;
    const idx = activeNoteAt(notesData.notes, status.currentTime);
    if (idx === null || idx === lastActiveRef.current) return;
    lastActiveRef.current = idx;
    const note = notesData.notes[idx];
    if (note === undefined) return;
    // All geometry in base 816×1056 page space, scaled once by zoom·fit —
    // the exact factor the FlatList items render at.
    const target = followOffset(note, pagesData.height, PAGE_GAP, zoom * fit, height);
    if (Math.abs(target - scrollYRef.current) > 24) {
      listRef.current?.scrollToOffset({ offset: target, animated: true });
    }
  }, [status.currentTime, status.playing, follow, zoom, fit, height]);

  const togglePlay = (): void => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.currentTime >= notesData.durationSec) player.seekTo(0);
      player.play();
      setFollow(true);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: tokens.page }]}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
            borderBottomColor: tokens.hairline,
            backgroundColor: tokens.chrome1,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={tokens.textMid} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: tokens.textHi }]}>Sample session — voice</Text>
          <Text style={[styles.subtitle, { color: tokens.textMid }, TABULAR_NUMS]}>
            Pentatonic root A · 106 BPM · faint notes are lower confidence
          </Text>
        </View>
      </View>

      {/* ── pages ──────────────────────────────────────────────────────────── */}
      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.pages, pinchStyle]}>
          <FlatList
            ref={listRef}
            data={pagesData.pages}
            keyExtractor={(_, i) => `page-${i}`}
            onScroll={(e) => {
              scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            onScrollBeginDrag={() => setFollow(false)}
            scrollEventThrottle={64}
            initialNumToRender={2}
            windowSize={5}
            getItemLayout={(_, index) => ({
              length: itemLength * fit,
              offset: itemLength * fit * index,
              index,
            })}
            contentContainerStyle={{ paddingVertical: spacing.base, alignItems: 'center' }}
            renderItem={({ item }) => (
              <View
                style={{
                  width: pageWidth * fit,
                  height: pageHeight * fit,
                  marginBottom: PAGE_GAP * zoom * fit,
                  backgroundColor: tokens.paper,
                  borderRadius: 2,
                }}
              >
                <SvgXml xml={item} width="100%" height="100%" />
              </View>
            )}
          />
        </Animated.View>
      </GestureDetector>

      {/* ── transport ──────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.transport,
          {
            paddingBottom: insets.bottom + spacing.sm,
            borderTopColor: tokens.hairline,
            backgroundColor: tokens.chrome1,
          },
        ]}
      >
        <Pressable
          onPress={togglePlay}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          style={[
            styles.playButton,
            { backgroundColor: tokens.chrome2, borderColor: tokens.hairline },
          ]}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color={tokens.accentLive} />
        </Pressable>
        <Text style={[styles.clock, { color: tokens.textHi }, TABULAR_NUMS]}>
          {formatTime(status.currentTime)}
          <Text style={{ color: tokens.textLow }}> / {formatTime(notesData.durationSec)}</Text>
        </Text>
        {!follow && (
          <Pressable
            onPress={() => setFollow(true)}
            accessibilityRole="button"
            accessibilityLabel="Follow the playing note"
            style={[
              styles.followChip,
              { borderColor: tokens.hairline, backgroundColor: tokens.chrome2 },
            ]}
          >
            <Text style={[styles.followText, { color: tokens.textMid }]}>Follow</Text>
          </Pressable>
        )}
        <Text style={[styles.zoomLabel, { color: tokens.textMid }, TABULAR_NUMS]}>
          {Math.round(zoom * 100)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fontFamilies.bodySemiBold, fontSize: 15 },
  subtitle: { fontFamily: fontFamilies.monoRegular, fontSize: 10 },
  pages: { flex: 1 },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clock: { fontFamily: fontFamilies.monoRegular, fontSize: 13 },
  followChip: {
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  followText: { fontFamily: fontFamilies.bodySemiBold, fontSize: 11 },
  zoomLabel: { marginLeft: 'auto', fontFamily: fontFamilies.monoRegular, fontSize: 11 },
});
