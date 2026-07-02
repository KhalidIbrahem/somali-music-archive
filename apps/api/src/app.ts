/**
 * Express app factory (ARCHITECTURE.md §8, §11 API Security).
 *
 * Assembles the security-hardened middleware stack in the correct order:
 *   helmet → cors → body limits → request logging → rate limiting → routes →
 *   404 → error handler. Exported as a factory so tests can spin up an app
 *   instance with Supertest without binding a port.
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from '@/config/env';
import { logger } from '@/shared/logger';
import { generalLimiter } from '@/shared/middleware/rateLimit';
import { errorHandler, notFoundHandler } from '@/shared/middleware/errorHandler';
import { healthRouter } from '@/modules/health/health.routes';
import { apiV1Router } from '@/routes';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer / Cloudflare — trust the first proxy so client IPs
  // (used for rate limiting) are read from X-Forwarded-For correctly.
  app.set('trust proxy', 1);

  // Security headers: HSTS, X-Frame-Options, CSP defaults, etc. (§11).
  app.use(helmet());

  // CORS restricted to the configured origins (§11 — allowed origins only).
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    }),
  );

  // JSON body limit of 10MB (§11). File uploads never hit the API — they go
  // straight to R2 via presigned URLs — so no multipart body parser is mounted.
  app.use(express.json({ limit: '10mb' }));

  // Structured request logging.
  app.use(pinoHttp({ logger }));

  // Health is public and un-throttled.
  app.use('/health', healthRouter);

  // General rate limit on the versioned API surface (§11).
  app.use('/api/v1', generalLimiter, apiV1Router);

  // Fallthrough: unmatched route + central error handler (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
