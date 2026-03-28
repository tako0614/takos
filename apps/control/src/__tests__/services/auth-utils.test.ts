import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  PASSWORD_PBKDF2_ITERATIONS,
  hashPassword,
  isValidRedirectUri,
  validateOAuthState,
  verifyPassword,
} from '@/services/identity/auth-utils';

function createMockDb() {
  const firstMock = vi.fn();
  const bindMock = vi.fn<(...args: unknown[]) => { first: typeof firstMock }>(() => ({
    first: firstMock,
  }));
  const prepareMock = vi.fn<(sql: string) => { bind: typeof bindMock }>(() => ({
    bind: bindMock,
  }));

  return {
    db: {
      prepare: prepareMock,
    } as unknown as D1Database,
    prepareMock,
    bindMock,
    firstMock,
  };
}

describe('validateOAuthState', () => {
  const validState = 'a'.repeat(64);
  const futureIso = new Date(Date.now() + 60_000).toISOString();

  it('fails closed without DB access for invalid state format', async () => {
    const { db, prepareMock } = createMockDb();

    const result = await validateOAuthState(db, 'not-a-hex-state');

    expect(result).toEqual({ valid: false });
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('atomically consumes state with a single DELETE ... RETURNING query', async () => {
    const { db, prepareMock, bindMock, firstMock } = createMockDb();
    firstMock.mockResolvedValue({
      redirect_uri: 'https://admin.takos.test/auth/callback',
      return_to: 'cli_state_1234567',
      cli_callback: 'http://localhost:3344/callback',
      expires_at: futureIso,
    });

    const result = await validateOAuthState(db, validState);

    expect(result).toEqual({
      valid: true,
      redirectUri: 'https://admin.takos.test/auth/callback',
      returnTo: 'cli_state_1234567',
      cliCallback: 'http://localhost:3344/callback',
    });
    expect(prepareMock).toHaveBeenCalledTimes(1);
    const firstPrepareCall = prepareMock.mock.calls.at(0) as [unknown] | undefined;
    const sql = String(firstPrepareCall?.[0] ?? '');
    expect(sql).toContain('DELETE FROM oauth_states');
    expect(sql).toContain('RETURNING redirect_uri, return_to, cli_callback, expires_at');
    expect(bindMock).toHaveBeenCalledWith(validState);
  });

  it('returns invalid when no state is consumed', async () => {
    const { db, prepareMock, firstMock } = createMockDb();
    firstMock.mockResolvedValue(null);

    const result = await validateOAuthState(db, validState);

    expect(result).toEqual({ valid: false });
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes nullable return fields to undefined', async () => {
    const { db, firstMock } = createMockDb();
    firstMock.mockResolvedValue({
      redirect_uri: 'https://admin.takos.test/auth/callback',
      return_to: null,
      cli_callback: null,
      expires_at: futureIso,
    });

    const result = await validateOAuthState(db, validState);

    expect(result).toEqual({
      valid: true,
      redirectUri: 'https://admin.takos.test/auth/callback',
      returnTo: undefined,
      cliCallback: undefined,
    });
  });

  it('fails closed after consuming an expired matched state', async () => {
    const { db, firstMock } = createMockDb();
    firstMock.mockResolvedValue({
      redirect_uri: 'https://admin.takos.test/auth/callback',
      return_to: null,
      cli_callback: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await validateOAuthState(db, validState);

    expect(result).toEqual({ valid: false });
  });

  it('fails closed when consumed state has invalid expires_at', async () => {
    const { db, firstMock } = createMockDb();
    firstMock.mockResolvedValue({
      redirect_uri: 'https://admin.takos.test/auth/callback',
      return_to: null,
      cli_callback: null,
      expires_at: 'not-a-date',
    });

    const result = await validateOAuthState(db, validState);

    expect(result).toEqual({ valid: false });
  });

  it('denies replay after first successful consume', async () => {
    const { db, prepareMock, firstMock } = createMockDb();
    firstMock
      .mockResolvedValueOnce({
        redirect_uri: 'https://admin.takos.test/auth/callback',
        return_to: null,
        cli_callback: null,
        expires_at: futureIso,
      })
      .mockResolvedValueOnce(null);

    const first = await validateOAuthState(db, validState);
    const second = await validateOAuthState(db, validState);

    expect(first.valid).toBe(true);
    expect(second).toEqual({ valid: false });
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });
});

describe('isValidRedirectUri', () => {
  it('fails closed to localhost-only defaults when no env config is provided', () => {
    expect(isValidRedirectUri('https://takos.jp/callback')).toBe(false);
    expect(isValidRedirectUri('http://localhost:3000/callback')).toBe(true);
  });

  it('accepts admin-domain fallback when caller provides it explicitly', () => {
    expect(isValidRedirectUri(
      'https://admin.takos.test/oauth/callback',
      undefined,
      ['admin.takos.test', 'localhost', '127.0.0.1']
    )).toBe(true);
  });

  it('accepts configured allowlist domains and subdomains over HTTPS', () => {
    expect(isValidRedirectUri(
      'https://client.example.com/oauth/callback',
      'example.com,service.example.net',
      ['admin.takos.test']
    )).toBe(true);
    expect(isValidRedirectUri(
      'https://service.example.net/oauth/callback',
      'example.com,service.example.net',
      ['admin.takos.test']
    )).toBe(true);
  });

  it('rejects non-HTTPS redirect on non-localhost domain even when configured', () => {
    expect(isValidRedirectUri(
      'http://client.example.com/oauth/callback',
      'example.com',
      ['admin.takos.test']
    )).toBe(false);
  });
});

describe('password hashing', () => {
  it('uses a Cloudflare-compatible PBKDF2 iteration count and verifies round-trip', async () => {
    expect(PASSWORD_PBKDF2_ITERATIONS).toBe(100000);

    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });
});
