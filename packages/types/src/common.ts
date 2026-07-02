/**
 * Cross-cutting primitive types shared by every domain model.
 *
 * WHY brand a handful of string IDs instead of using bare `string`: the platform
 * juggles two very different identifier spaces — PostgreSQL UUIDs (users,
 * subscriptions) and MongoDB ObjectIds-as-strings (recordings, artists). They are
 * both `string` at runtime, so nothing stops you passing a user id where a
 * recording id is expected. A structural brand makes that a compile error without
 * any runtime cost, which matters in a codebase meant to be maintained for
 * decades by people who did not write it.
 */

declare const __brand: unique symbol;

/** A nominal wrapper around a base type. Zero runtime cost — erased at compile. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** PostgreSQL v4 UUID (users, subscriptions, tokens, api keys, progress rows). */
export type Uuid = Brand<string, 'Uuid'>;

/** MongoDB ObjectId serialised as a 24-char hex string (recordings, artists). */
export type ObjectIdString = Brand<string, 'ObjectId'>;

/**
 * An ISO-8601 date-time string, e.g. `2024-01-15T10:30:00Z`.
 * All timestamps cross the wire as strings (JSON has no Date) — the domain layer
 * decides when to hydrate them into `Date`. Storing the convention in one place
 * keeps every API contract consistent (ARCHITECTURE.md §12).
 */
export type IsoDateTimeString = Brand<string, 'IsoDateTime'>;

/** Make the listed keys of `T` optional, leaving the rest untouched. */
export type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** A value that has been soft-deleted carries a deletion timestamp (never hard-deleted). */
export interface SoftDeletable {
  /** Set when soft-deleted; absent/undefined while live. Recordings are NEVER hard-deleted. */
  readonly deletedAt?: IsoDateTimeString;
}

/** Standard created/updated audit stamps present on every persisted document. */
export interface Timestamps {
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}
