/**
 * Brand-cast helpers for the trust boundary between raw storage values and the
 * branded domain types in @sma/types. Branded types (Uuid, IsoDateTimeString,
 * ObjectIdString) are compile-time-only — there is no runtime constructor — so a
 * cast is unavoidable when data crosses from the DB into the domain. Centralising
 * the casts here keeps `as` assertions out of business logic and gives one place
 * to add real runtime validation later if desired.
 */

import type { IsoDateTimeString, ObjectIdString, Uuid } from '@sma/types';

export const asUuid = (value: string): Uuid => value as Uuid;

export const asObjectId = (value: string): ObjectIdString => value as ObjectIdString;

export const asIso = (value: Date | string): IsoDateTimeString =>
  (typeof value === 'string' ? value : value.toISOString()) as IsoDateTimeString;
