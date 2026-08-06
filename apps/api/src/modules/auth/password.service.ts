/**
 * Password hashing (CONVENTIONS.md hard rule: bcrypt, 12 rounds).
 *
 * Centralised so the cost factor is defined exactly once and can never be set
 * lower by accident elsewhere. A leaked database of these hashes reveals no
 * plaintext passwords (ARCHITECTURE.md §11 Threat 2/7).
 *
 * bcryptjs (pure JS) rather than native bcrypt: same algorithm and `$2b$` hash
 * format, but no platform-specific binary — required for the Vercel serverless
 * bundle, whose file tracer only ships the build machine's native prebuilds.
 */

import bcrypt from 'bcryptjs';

/** Cost factor. Higher = slower = more brute-force resistant. 12 per spec. */
export const BCRYPT_ROUNDS = 12;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
