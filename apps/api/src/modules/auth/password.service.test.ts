import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, BCRYPT_ROUNDS } from './password.service';

describe('password.service', () => {
  it('uses a cost factor of 12 (CLAUDE.md hard rule)', () => {
    expect(BCRYPT_ROUNDS).toBe(12);
  });

  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('oudwood7');
    expect(hash).not.toBe('oudwood7');
    expect(await verifyPassword('oudwood7', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('oudwood7');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
