/**
 * Theme — the single import surface for every design token in the mobile app.
 *
 *   import { colors, spacing, typography, shadows, radius } from '@/theme';
 *
 * The composed `theme` object is convenient for context providers; the individual
 * named exports are convenient inside StyleSheet.create. Both are provided.
 */

export * from './colors';
export * from './typography';
export * from './spacing';
export * from './shadows';
export * from './studio';

import { colors } from './colors';
import { typography, fontFamilies } from './typography';
import { spacing, radius, MIN_TOUCH_TARGET } from './spacing';
import { shadows } from './shadows';

export const theme = {
  colors,
  typography,
  fontFamilies,
  spacing,
  radius,
  shadows,
  minTouchTarget: MIN_TOUCH_TARGET,
} as const;

export type Theme = typeof theme;
