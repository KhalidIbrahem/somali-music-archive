/**
 * Password hashing (CLAUDE.md hard rule: bcrypt, 12 rounds).
 *
 * Centralised so the cost factor is defined exactly once and can never be set
 * lower by accident elsewhere. A leaked database of these hashes reveals no
 * plaintext passwords (ARCHITECTURE.md §11 Threat 2/7).
 */

import bcrypt from 'bcrypt';

/** Cost factor. Higher = slower = more brute-force resistant. 12 per spec. */
export const BCRYPT_ROUNDS = 12;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
