import { describe, expect, it } from 'vitest';
import { accountSyncEnabled } from '../syncPolicy';

describe('accountSyncEnabled', () => {
  it('stays off in a production build without an API URL, even when signed in', () => {
    expect(accountSyncEnabled({ apiUrl: undefined, nodeEnv: 'production', token: 't' })).toBe(
      false,
    );
    expect(accountSyncEnabled({ apiUrl: '', nodeEnv: 'production', token: 't' })).toBe(false);
  });

  it('is on in production when the API URL is set and the member is signed in', () => {
    expect(
      accountSyncEnabled({
        apiUrl: 'https://api.example.org/api/v1',
        nodeEnv: 'production',
        token: 't',
      }),
    ).toBe(true);
  });

  it('keeps the localhost fallback in development', () => {
    expect(accountSyncEnabled({ apiUrl: undefined, nodeEnv: 'development', token: 't' })).toBe(
      true,
    );
  });

  it('is off whenever the visitor is signed out', () => {
    expect(
      accountSyncEnabled({
        apiUrl: 'https://api.example.org/api/v1',
        nodeEnv: 'production',
        token: null,
      }),
    ).toBe(false);
    expect(accountSyncEnabled({ apiUrl: undefined, nodeEnv: 'development', token: null })).toBe(
      false,
    );
  });
});
