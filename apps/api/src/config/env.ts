/**
 * Validated environment configuration (ARCHITECTURE.md §18, §11 Infrastructure).
 *
 * The process refuses to boot with a missing or malformed variable. This is a
 * security control as much as an ergonomic one: a JWT secret that is too short,
 * or a forgotten R2 credential, must fail immediately and visibly rather than
 * degrade into a subtle runtime vulnerability. Nothing else in the codebase reads
 * `process.env` directly — everything imports the typed `env` object below.
 *
 * The schema itself lives in envSchema.ts (side-effect-free) so the preflight
 * doctor can inspect a broken environment without this module's fail-fast throw.
 */

import { envSchema, type Env } from './envSchema';

export type { Env };

/** Parse `process.env` once, failing fast with a readable report. */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
    throw new Error('Invalid environment configuration — see errors above.');
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
