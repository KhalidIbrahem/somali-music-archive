/**
 * Small cryptographic helpers used by the auth layer (ARCHITECTURE.md §11).
 *
 * High-entropy secrets (refresh tokens, verification/reset tokens) are stored as
 * a SHA-256 hash, never in plaintext — a database leak reveals nothing usable.
 * SHA-256 (not bcrypt) is the right tool here: these tokens are already random and
 * long, so we do not need bcrypt's slow salting, and a plain hash gives O(1)
 * lookup for rotation. bcrypt remains reserved for user passwords (low entropy).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Hex SHA-256 of a value — the at-rest form of tokens. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A cryptographically-random opaque token (default 32 bytes → 64 hex chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export { randomUUID };
