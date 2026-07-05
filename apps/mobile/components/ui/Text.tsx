/**
 * Text — the typed typography primitive. Every string on screen renders through
 * this so font family, size, and color always come from the design tokens
 * (ARCHITECTURE.md §7) rather than ad-hoc styles.
 */

import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, typography, type TypographyVariant } from '@/theme';
import { useIsRTL } from '@/i18n';

/** Semantic text colors, mapped to the palette. */
type TextColor =
  'primary' | 'secondary' | 'tertiary' | 'inverse' | 'accent' | 'error' | 'warning' | 'success';

const COLOR_MAP: Record<TextColor, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  tertiary: colors.text.tertiary,
  inverse: colors.text.inverse,
  accent: colors.amber.primary,
  error: colors.error,
  warning: colors.warning,
  success: colors.success,
};

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  color?: TextColor;
}

export function Text({
  variant = 'bodyMedium',
  color = 'primary',
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const rtl = useIsRTL();
  const base: TextStyle = { ...typography[variant], color: COLOR_MAP[color] };
  // Arabic (RTL): reverse the writing direction and right-align by default. Both
  // sit before `style`, so any caller override (e.g. textAlign: 'center') still wins.
  const dir: TextStyle | null = rtl ? { writingDirection: 'rtl', textAlign: 'right' } : null;
  return <RNText style={[base, dir, style]} {...rest} />;
}
