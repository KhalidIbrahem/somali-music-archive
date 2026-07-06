/**
 * Environment schema (ARCHITECTURE.md §18, §11 Infrastructure).
 *
 * Deliberately side-effect-free: this module only DEFINES the schema. `env.ts`
 * imports it and validates process.env at boot (throwing on failure); the
 * preflight doctor (scripts/doctor.ts) imports it to DIAGNOSE a broken
 * environment — which it could not do if importing the schema also threw.
 */

import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),
  /** Comma-separated allowed CORS origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  // JWT — secrets must be long enough to be meaningfully secure (§11).
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),

  // Databases
  MONGODB_URI: z.string().min(1),
  POSTGRES_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /**
   * Which persistence backend the repositories use. `memory` (default) keeps the
   * in-memory repositories — zero infrastructure, used by tests and local dev
   * without a database. `database` switches to the Prisma/Postgres + Mongoose/Mongo
   * repositories (requires POSTGRES_URL + MONGODB_URI to point at real databases).
   * Also read directly from process.env by shared/db/driver so repository modules
   * stay import-safe in the env-light script contexts (seed/promote).
   */
  PERSISTENCE: z.enum(['memory', 'database']).default('memory'),

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

  // Search (Elasticsearch) — opt-in full-text backend (docker compose --profile
  // search). Empty URL → the API uses the built-in in-memory search index
  // (ADR-0005 interface-first), so it boots and search works without ES running.
  ELASTICSEARCH_URL: z.string().default(''),
  ELASTICSEARCH_INDEX: z.string().default('recordings'),

  // Observability
  SENTRY_DSN: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;
