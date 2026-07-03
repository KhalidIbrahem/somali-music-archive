import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest config for the API. `setupFiles` populates a valid test environment
 * BEFORE any module imports `@/config/env` (which validates and would otherwise
 * throw). The `@` alias mirrors tsconfig `paths`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Integration tests exercise real bcrypt (12 rounds) many times over — the
    // default 5s is too tight for the brute-force/lockout flow on a busy machine.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
