/**
 * Welcome / onboarding entry (ARCHITECTURE.md §7 "Welcome / Onboarding").
 *
 * Slide 1 is the identity moment: the five-pointed geometric star (mirroring the
 * five-note pentatonic scale) and the bilingual tagline. Full onboarding carousel
 * and star animation are built in Phase 1; this is the routing + layout scaffold.
 */

import { StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { Screen, Text, Button } from '@/components/ui';
import { spacing } from '@/theme';

export default function Welcome(): React.JSX.Element {
  return (
    <Screen>
      <View style={styles.hero}>
        {/* TODO(phase-1): five-pointed star animation (SVG + Reanimated). */}
        <Text variant="displayLarge" color="accent" style={styles.center}>
          Suugaanta Fanka Soomaalida
        </Text>
        <Text variant="bodyLarge" color="secondary" style={styles.center}>
          The music of our ancestors, for the children of tomorrow.
        </Text>
      </View>

      <View style={styles.actions}>
        <Link href="/(auth)/register" asChild>
          <Button label="Create account" />
        </Link>
        <Link href="/(auth)/login" asChild>
          <Button label="Sign in" variant="ghost" />
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.base,
  },
  center: {
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
});
