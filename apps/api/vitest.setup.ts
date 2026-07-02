/**
 * Test environment. Sets the minimum valid configuration so `@/config/env` parses
 * successfully during tests. These are dummy values — nothing here reaches a real
 * service. NODE_ENV=test also disables rate limiting (see rateLimit.ts).
 */

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3001',
  API_URL: 'http://localhost:3001',
  CORS_ORIGINS: 'http://localhost:8081',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-0',
  JWT_ACCESS_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '30d',
  MONGODB_URI: 'mongodb://localhost:27017/test',
  POSTGRES_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  R2_ACCOUNT_ID: 'test',
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET_NAME: 'test-bucket',
  R2_PUBLIC_DOMAIN: 'https://cdn.example.com',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  STRIPE_PREMIUM_PRICE_ID: 'price_dummy',
  STRIPE_INSTITUTIONAL_PRICE_ID: 'price_dummy2',
  RESEND_API_KEY: 'test',
  EMAIL_FROM: 'noreply@example.com',
  AI_SERVICE_URL: 'http://localhost:8000',
  AI_SERVICE_API_KEY: 'test',
  LOG_LEVEL: 'silent',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
