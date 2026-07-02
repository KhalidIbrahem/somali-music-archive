/**
 * Wrap an async Express handler so a rejected promise is forwarded to `next()`
 * and lands in the central error handler. Without this, an awaited throw inside a
 * handler becomes an unhandled rejection instead of a clean error response.
 */

import type { NextFunction, Request, Response } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
