/**
 * Health & readiness (ARCHITECTURE.md §13 — uptime monitoring). Public, unauthenticated,
 * and cheap: used by the load balancer and BetterUptime. Deep dependency checks
 * (Mongo/Postgres/Redis pings) are added as a separate /health/ready in Phase 1.
 */

import { Router, type Request, type Response } from 'express';
import { sendSuccess } from '@/shared/http/respond';

export const healthRouter: Router = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  sendSuccess(res, {
    status: 'ok' as const,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
