/**
 * Input — a labelled text field with an inline error slot, for forms built on
 * react-hook-form. Focus ring is always amber (ARCHITECTURE.md §7 border.focus).
 *
 * Set `showPasswordToggle` to render a secure field with an eye button that
 * reveals/hides the value. The toggle manages its own secure state, so callers
 * do not pass `secureTextEntry` themselves.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, MIN_TOUCH_TARGET } from '@/theme';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label: string;
  /**
   * Validation message shown below the field, if any. Typed `| undefined`
   * explicitly so callers can forward `errors.field?.message` (string | undefined)
   * directly under `exactOptionalPropertyTypes`.
   */
  error?: string | undefined;
  /** Render as a password field with a reveal/hide eye toggle. */
  showPasswordToggle?: boolean;
}

export function Input({
  label,
  error,
  showPasswordToggle = false,
  style,
  ...rest
}: InputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const secureTextEntry = showPasswordToggle ? !revealed : rest.secureTextEntry;

  return (
    <View style={styles.wrapper}>
      <Text variant="labelLarge" color="secondary">
        {label}
      </Text>
      <View>
        <TextInput
          {...rest}
          secureTextEntry={secureTextEntry}
          style={[
            styles.input,
            showPasswordToggle ? styles.inputWithAccessory : null,
            focused ? styles.focused : null,
            error ? styles.errored : null,
            style,
          ]}
          placeholderTextColor={colors.text.tertiary}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          accessibilityLabel={label}
        />
        {showPasswordToggle ? (
          <Pressable
            style={styles.toggle}
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.text.secondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="bodySmall" color="error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing.md,
    color: colors.text.primary,
    ...typography.bodyMedium,
  },
  inputWithAccessory: {
    // Leave room for the eye toggle so text never sits under it.
    paddingRight: MIN_TOUCH_TARGET,
  },
  focused: {
    borderColor: colors.border.focus,
  },
  errored: {
    borderColor: colors.error,
  },
  toggle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
