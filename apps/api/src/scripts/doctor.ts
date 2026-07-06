/**
 * Preflight doctor — production-readiness report (SESSION "preflight doctor",
 * P5-02 database cutover).
 *
 *   npm run doctor              # everything
 *   npm run doctor -- --local   # skip external paid services (R2, Stripe, AI)
 *
 * Probes every external dependency the API needs in PERSISTENCE=database mode
 * and prints a ✓/△/✗ report: env completeness, Postgres (schema + pgvector),
 * Mongo (+ feed index), Redis, R2, the AI service, and Stripe. Exit code 1 when
 * anything FAILS (warnings pass — they are boot-time self-healing or pending
 * one-time setup, each explained in its detail line).
 *
 * Secret VALUES are never printed — only variable names and hostnames.
 * Run this after rotating credentials (P5-01) and before flipping
 * PERSISTENCE=database (P5-02).
 */

import '@/config/bootstrapEnv'; // load .env — deliberately NOT @/config/env (it throws)
import {
  checkEnv,
  checkHttpHealth,
  checkMongo,
  checkPostgres,
  checkR2,
  checkRedis,
  checkStripe,
  formatReport,
  type CheckResult,
} from '@/shared/preflight/checks';

async function main(): Promise<void> {
  const localOnly = process.argv.includes('--local');
  const env = process.env;
  const results: CheckResult[] = [];
  const skip = (name: string, why: string): CheckResult => ({ name, status: 'skip', detail: why });

  // eslint-disable-next-line no-console
  console.log('\nSomali Music Archive — preflight doctor\n');

  results.push(checkEnv(env));

  results.push(
    env['POSTGRES_URL']
      ? await checkPostgres(env['POSTGRES_URL'])
      : skip('postgres', 'POSTGRES_URL not set'),
  );
  results.push(
    env['MONGODB_URI']
      ? await checkMongo(env['MONGODB_URI'])
      : skip('mongo', 'MONGODB_URI not set'),
  );
  results.push(
    env['REDIS_URL'] ? await checkRedis(env['REDIS_URL']) : skip('redis', 'REDIS_URL not set'),
  );

  if (localOnly) {
    results.push(skip('r2', '--local'), skip('ai-service', '--local'), skip('stripe', '--local'));
  } else {
    results.push(
      env['R2_ACCOUNT_ID'] &&
        env['R2_ACCESS_KEY_ID'] &&
        env['R2_SECRET_ACCESS_KEY'] &&
        env['R2_BUCKET_NAME']
        ? await checkR2({
            accountId: env['R2_ACCOUNT_ID'],
            accessKeyId: env['R2_ACCESS_KEY_ID'],
            secretAccessKey: env['R2_SECRET_ACCESS_KEY'],
            bucket: env['R2_BUCKET_NAME'],
          })
        : skip('r2', 'R2_* variables not set'),
    );
    results.push(
      env['AI_SERVICE_URL']
        ? await checkHttpHealth('ai-service', env['AI_SERVICE_URL'])
        : skip('ai-service', 'AI_SERVICE_URL not set'),
    );
    results.push(
      env['STRIPE_SECRET_KEY']
        ? await checkStripe(env['STRIPE_SECRET_KEY'])
        : skip('stripe', 'STRIPE_SECRET_KEY not set'),
    );
  }

  const { text, failures } = formatReport(results);
  // eslint-disable-next-line no-console
  console.log(text);
  // eslint-disable-next-line no-console
  console.log(
    `\n  PERSISTENCE=${env['PERSISTENCE'] ?? 'memory (default)'} — ` +
      (failures === 0
        ? 'ready for the database cutover (P5-02).'
        : 'fix the failures above before flipping to database mode.') +
      '\n',
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('✗ doctor crashed:', error);
  process.exit(1);
});
