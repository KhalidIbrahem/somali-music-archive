/**
 * Block 1 studio tokens — the mobile view of the shared design-token source.
 *
 * Values live in @sma/constants (packages/constants/src/designTokens.json);
 * the web app consumes the same source through a generated tokens.css, so the
 * two platforms cannot drift. Import from here, never hardcode hex values.
 *
 * Governing rule (§1): the score canvas (paper) is always the lightest surface
 * on screen, in both themes. Confidence ink is theme-independent — always
 * ink-black on paper, opacity graded by transcription confidence.
 */

import type { TextStyle } from 'react-native';

export {
  studioThemes,
  studioLayout,
  CONFIDENCE_INK,
  CONFIDENCE_TIERS,
  confidenceTier,
  confidenceAlpha,
} from '@sma/constants';
export type { StudioTheme, StudioThemeName, ConfidenceTier } from '@sma/constants';

/**
 * Every numeric readout (timecode, BPM, confidence %, Hz, durations) renders in
 * the mono face with tabular figures so numbers never reflow as they update:
 *
 *   <Text style={[{ fontFamily: fontFamilies.monoRegular }, TABULAR_NUMS]}>
 */
export const TABULAR_NUMS: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
};
