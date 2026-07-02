/**
 * Structured logger (ARCHITECTURE.md §8 — structured JSON logs).
 *
 * We use pino: it emits structured JSON in production (ingestible by Grafana/Loki)
 * and pretty output could be layered in dev via a transport. NOTE: this is a
 * deliberate substitution for the "Winston" named in the stack table — see
 * docs/DECISIONS.md. Never log secrets or PII (§11).
 */

import pino, { type LoggerOptions } from 'pino';
import { env, isProduction } from '@/config/env';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  // Redact common secret-bearing fields defensively.
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'token', '*.token'],
    remove: true,
  },
};

// In dev, strip the default pid/hostname bindings for cleaner local logs; keep
// them in production where they aid correlation. `base: null` removes them.
if (!isProduction) {
  options.base = null;
}

export const logger = pino(options);
