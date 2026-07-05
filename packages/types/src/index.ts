/**
 * @sma/types — barrel export.
 *
 * The public surface of the shared domain/wire contracts. Import from the package
 * root (`import type { Recording, ApiResponse } from '@sma/types'`) so the internal
 * file layout can evolve without breaking any consumer.
 *
 * These are type-only declarations — this package emits nothing at runtime.
 */

export * from './common';
export * from './artist';
export * from './recording';
export * from './user';
export * from './subscription';
export * from './lesson';
export * from './research';
export * from './api';
