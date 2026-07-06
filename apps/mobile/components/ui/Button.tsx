/**
 * Button — the primary interactive control (ARCHITECTURE.md §7).
 *
 * Amber is the signature accent, used only for primary CTAs. Every variant meets
 * the 44pt minimum touch target (§7 Accessibility) and exposes an accessibility
 * role/label. A `loading` state disables the button and shows a spinner.
 */

import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { colors, radius, spacing, MIN_TOUCH_TARGET } from '@/theme';
import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled = false,
  ...rest
}: ButtonProps): React.JSX.Element {
  const isInactive = disabled || loading;
  const spinnerColor = variant === 'primary' ? colors.text.inverse : colors.amber.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isInactive ? styles.pressed : null,
        isInactive ? styles.inactive : null,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={spinnerColor} /> : null}
        <Text
          variant="bodyLarge"
          color={variant === 'primary' ? 'inverse' : 'accent'}
          style={loading ? styles.labelWhileLoading : null}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: colors.amber.primary,
  },
  secondary: {
    backgroundColor: colors.bg.tertiary,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.85,
  },
  inactive: {
    opacity: 0.5,
  },
  labelWhileLoading: {
    opacity: 0,
  },
});
