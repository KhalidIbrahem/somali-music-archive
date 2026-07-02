/**
 * User — an account in PostgreSQL (ARCHITECTURE.md §9).
 *
 * The password hash NEVER appears in this type: it exists only in the database
 * row and the server's persistence layer. Every type a client can receive is
 * derived from `User`, which itself already excludes secrets. This makes it a
 * compile error to accidentally serialise a credential to the wire.
 */

import type { UiLanguage } from '@sma/constants';
import type { Uuid, IsoDateTimeString, SoftDeletable } from './common';

/** Role-based access control tiers (ARCHITECTURE.md §11 Authorization). */
export type UserRole = 'listener' | 'contributor' | 'admin';

export interface User extends SoftDeletable {
  readonly id: Uuid;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  /** Preferred UI language. Defaults to Somali (Principle 1). */
  readonly language: UiLanguage;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly emailVerifiedAt?: IsoDateTimeString;
  readonly lastLoginAt?: IsoDateTimeString;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

/**
 * The user object returned to the client after auth. Identical to `User` today,
 * but named separately so that if `User` ever gains server-only fields, the
 * public shape does not silently widen. Never add secrets to this type.
 */
export type PublicUser = User;

/** A row in `saved_recordings` — a bookmark. */
export interface SavedRecording {
  readonly recordingId: string;
  readonly savedAt: IsoDateTimeString;
}

/** A row in `play_history`. */
export interface PlayHistoryEntry {
  readonly recordingId: string;
  readonly playedAt: IsoDateTimeString;
  /** How long the user actually listened, in seconds. */
  readonly durationSec?: number;
}
