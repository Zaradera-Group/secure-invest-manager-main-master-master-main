import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBackendAccessToken, setBackendAccessTokenProvider } from './backendAccessToken';

describe('backend access token provider', () => {
  afterEach(() => {
    setBackendAccessTokenProvider(null);
  });

  it('uses the registered identity-provider token', async () => {
    setBackendAccessTokenProvider(async () => 'auth0-access-token');

    await expect(getBackendAccessToken()).resolves.toBe('auth0-access-token');
  });

  it('does not silently fall back to another provider when the active provider has no session', async () => {
    setBackendAccessTokenProvider(async () => null);

    await expect(getBackendAccessToken('Sign in required.')).rejects.toThrow('Sign in required.');
  });
});
