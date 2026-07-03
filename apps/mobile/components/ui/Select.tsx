/**
 * Select — a labelled dropdown that opens a modal option list. Used for the
 * single-choice metadata fields (genre, occasion, region). Dark modal sheet with
 * an amber check on the current selection; meets the 44pt touch target.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, MIN_TOUCH_TARGET } from '@/theme';
import { Text } from './Text';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  label: string;
  value?: string | undefined;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | undefined;
  style?: ViewStyle;
}

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  error,
  style,
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={[styles.wrapper, style]}>
      <Text variant="labelLarge" color="secondary">
        {label}
      </Text>
      <Pressable
        style={[styles.field, error ? styles.errored : null]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
      >
        <Text variant="bodyMedium" color={selected ? 'primary' : 'tertiary'} style={styles.flex}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.text.secondary} />
      </Pressable>
      {error ? (
        <Text variant="bodySmall" color="error">
          {error}
        </Text>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text variant="labelLarge" color="secondary" style={styles.sheetTitle}>
              {label.toUpperCase()}
            </Text>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    style={styles.option}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text variant="bodyLarge" color={active ? 'accent' : 'primary'}>
                      {option.label}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={20} color={colors.amber.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  field: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errored: {
    borderColor: colors.error,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.static.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg.tertiary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.base,
    maxHeight: '70%',
  },
  sheetTitle: {
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.secondary,
  },
});
