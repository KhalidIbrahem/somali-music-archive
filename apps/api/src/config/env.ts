/**
 * Validated environment configuration (ARCHITECTURE.md §18, §11 Infrastructure).
 *
 * The process refuses to boot with a missing or malformed variable. This is a
 * security control as much as an ergonomic one: a JWT secret that is too short,
 * or a forgotten R2 credential, must fail immediately and visibly rather than
 * degrade into a subtle runtime vulnerability. Nothing else in the codebase reads
 * `process.env` directly — everything imports the typed `env` object below.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),
  /** Comma-separated allowed CORS origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  // JWT — secrets must be long enough to be meaningfully secure (§11).
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),

  // Databases
  MONGODB_URI: z.string().min(1),
  POSTGRES_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Cloudflare R2
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_DOMAIN: z.string().url(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PREMIUM_PRICE_ID: z.string().min(1),
  STRIPE_INSTITUTIONAL_PRICE_ID: z.string().min(1),

  // Email
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),

  // AI service
  AI_SERVICE_URL: z.string().url(),
  AI_SERVICE_API_KEY: z.string().min(1),

  // Observability
  SENTRY_DSN: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

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
