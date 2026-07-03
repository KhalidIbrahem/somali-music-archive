/**
 * @sma/validators — barrel export.
 *
 * The public surface of the shared Zod schemas. Import from the package root
 * (`import { registerSchema } from '@sma/validators'`). Every API input is
 * validated with one of these schemas (CLAUDE.md hard rule), and the mobile/web
 * forms reuse the same schemas so client and server agree on what is valid.
 */

export * from './common';
export * from './auth';
export * from './recording';
export * from './user';
export * from './lesson';
export * from './subscription';
export * from './notification';
