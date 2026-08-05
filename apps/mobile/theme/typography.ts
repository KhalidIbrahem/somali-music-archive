/**
 * Typography scale (ARCHITECTURE.md §7).
 *
 * Two families, loaded via expo-google-fonts and registered in the root layout:
 *   • Playfair Display — display/headings (artist names, song titles, hero text)
 *   • Nunito           — all UI chrome and body copy
 *
 * The `fontFamily` strings MUST match the keys the fonts are registered under in
 * `app/_layout.tsx` (e.g. `PlayfairDisplay_700Bold`). Keep them in sync.
 */

import type { TextStyle } from 'react-native';

/** Font-family identifiers as registered with expo-font at app startup. */
export const fontFamilies = {
  displayBold: 'PlayfairDisplay_700Bold',
  displayMedium: 'PlayfairDisplay_500Medium',
  displayRegular: 'PlayfairDisplay_400Regular',
  bodyBold: 'Nunito_700Bold',
  bodySemiBold: 'Nunito_600SemiBold',
  bodyMedium: 'Nunito_500Medium',
  bodyRegular: 'Nunito_400Regular',
  // Mono — numeric readouts only: timecode, BPM, confidence %, Hz (Block 1 §1).
  monoSemiBold: 'IBMPlexMono_600SemiBold',
  monoMedium: 'IBMPlexMono_500Medium',
  monoRegular: 'IBMPlexMono_400Regular',
} as const;

/** A single typographic role. Typed as a subset of RN `TextStyle` for safety. */
export type TypeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight'>;

export const typography = {
  // Display — used for artist names, song titles, hero text.
  displayLarge: { fontFamily: fontFamilies.displayBold, fontSize: 32, lineHeight: 40 },
  displayMedium: { fontFamily: fontFamilies.displayMedium, fontSize: 24, lineHeight: 32 },
  displaySmall: { fontFamily: fontFamilies.displayRegular, fontSize: 20, lineHeight: 28 },

  // Body — all UI chrome and content text.
  bodyLarge: { fontFamily: fontFamilies.bodySemiBold, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: fontFamilies.bodyRegular, fontSize: 14, lineHeight: 22 },
  bodySmall: { fontFamily: fontFamilies.bodyRegular, fontSize: 12, lineHeight: 18 },

  // Labels — tabs, badges, metadata tags.
  labelLarge: { fontFamily: fontFamilies.bodyBold, fontSize: 12, lineHeight: 16 },
  labelMedium: { fontFamily: fontFamilies.bodySemiBold, fontSize: 11, lineHeight: 14 },
  labelSmall: { fontFamily: fontFamilies.bodyMedium, fontSize: 10, lineHeight: 12 },

  // Numeric readouts — pair with TABULAR_NUMS from theme/studio so figures
  // never reflow as they update (timecode, BPM, confidence %, Hz).
  numericMedium: { fontFamily: fontFamilies.monoRegular, fontSize: 13, lineHeight: 18 },
  numericSmall: { fontFamily: fontFamilies.monoRegular, fontSize: 11, lineHeight: 14 },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;
