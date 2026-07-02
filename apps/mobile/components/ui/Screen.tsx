/**
 * Screen — the standard page container. Applies the primary background and safe-area
 * insets so individual screens never re-implement layout chrome.
 */

import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

export interface ScreenProps extends ViewProps {
  /** Apply the default horizontal screen padding (16px). Default true. */
  padded?: boolean;
  /** Safe-area edges to inset. Default: top + bottom. */
  edges?: readonly Edge[];
}

export function Screen({
  padded = true,
  edges = ['top', 'bottom'],
  style,
  children,
  ...rest
}: ScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.body, padded ? styles.padded : null, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  body: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.base,
  },
});
