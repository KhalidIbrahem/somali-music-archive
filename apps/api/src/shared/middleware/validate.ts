/**
 * Zod validation middleware (CLAUDE.md hard rule: Zod on every single API input).
 *
 * Pass the schemas for whichever request parts an endpoint accepts. On success the
 * PARSED (coerced + defaulted) values replace the raw ones, so handlers receive
 * clean, typed data. On failure we throw a VALIDATION_ERROR AppError that the
 * central error handler serialises into the standard envelope.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { appErrorFromZod } from '@/shared/errors/fromZod';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      // Express query/params are re-assigned with parsed values (Express 4 allows
      // this); coercion in the schema turns `?page=2` into a real number.
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (err) {
      // ZodError → typed 400; anything else bubbles to the error handler as 500.
      if (err && typeof err === 'object' && 'issues' in err) {
        next(appErrorFromZod(err as never));
        return;
      }
      next(err);
    }
  };
}
