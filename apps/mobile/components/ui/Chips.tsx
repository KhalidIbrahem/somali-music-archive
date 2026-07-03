/**
 * Chips — a labelled multi-select of toggle chips. Used for instruments on the
 * record screen. Selected chips fill with amber; each chip is a 44pt touch target.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@/theme';
import { Text } from './Text';

export interface ChipOption {
  label: string;
  value: string;
}

export interface ChipsProps {
  label: string;
  options: readonly ChipOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  error?: string | undefined;
}

export function Chips({ label, options, value, onChange, error }: ChipsProps): React.JSX.Element {
  const toggle = (v: string): void => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  return (
    <View style={styles.wrapper}>
      <Text variant="labelLarge" color="secondary">
        {label}
      </Text>
      <View style={styles.row}>
        {options.map((option) => {
          const active = value.includes(option.value);
          return (
            <Pressable
              key={option.value}
              style={[styles.chip, active ? styles.chipActive : null]}
              onPress={() => toggle(option.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={option.label}
            >
              <Text variant="bodyMedium" color={active ? 'inverse' : 'primary'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
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
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.primary,
    backgroundColor: colors.bg.secondary,
  },
  chipActive: {
    backgroundColor: colors.amber.primary,
    borderColor: colors.amber.primary,
  },
});
