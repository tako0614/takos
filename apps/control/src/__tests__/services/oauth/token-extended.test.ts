import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  buildAuthorizationCodeTokenFamily,
  RefreshTokenReuseDetectedError,
} from '@/services/oauth/token';
import { OAUTH_CONSTANTS } from '@/types/oauth';

// ---------------------------------------------------------------------------
// Token generation and verification tests
// ---------------------------------------------------------------------------

describe('generateAccessToken', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    privateKeyPem = await jose.exportPKCS8(privateKey);
    publicKeyPem = await jose.exportSPKI(publicKey);
  });

  it('generates a valid JWT with correct claims', async () => {
    const { token, jti, expiresAt } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid profile',
    });

    expect(token).toBeTruthy();
    expect(jti).toBeTruthy();
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify the token
    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer: 'https://admin.takos.test',
    });

    expect(payload).not.toBeNull();
    expect(payload!.iss).toBe('https://admin.takos.test');
    expect(payload!.sub).toBe('user-1');
    expect(payload!.aud).toBe('client-1');
    expect(payload!.client_id).toBe('client-1');
    expect(payload!.scope).toBe('openid profile');
    expect(payload!.jti).toBe(jti);
  });

  it('uses default expiry of ACCESS_TOKEN_EXPIRES_IN seconds', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { expiresAt } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
    });
    const after = Math.floor(Date.now() / 1000);

    const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
    expect(expiresAtSec).toBeGreaterThanOrEqual(before + OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN);
    expect(expiresAtSec).toBeLessThanOrEqual(after + OAUTH_CONSTANTS.ACCESS_TOKEN_EXPIRES_IN + 1);
  });

  it('supports custom expiry', async () => {
    const customExpiry = 600;
    const before = Math.floor(Date.now() / 1000);
    const { expiresAt } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
      expiresInSeconds: customExpiry,
    });

    const expiresAtSec = Math.floor(expiresAt.getTime() / 1000);
    expect(expiresAtSec).toBeGreaterThanOrEqual(before + customExpiry);
    expect(expiresAtSec).toBeLessThanOrEqual(before + customExpiry + 2);
  });

  it('sets at+jwt type header', async () => {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
    });

    const header = jose.decodeProtectedHeader(token);
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('at+jwt');
  });
});

describe('verifyAccessToken', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    privateKeyPem = await jose.exportPKCS8(privateKey);
    publicKeyPem = await jose.exportSPKI(publicKey);
  });

  it('returns null for an expired token', async () => {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
      expiresInSeconds: -1, // already expired
    });

    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer: 'https://admin.takos.test',
    });

    expect(payload).toBeNull();
  });

  it('returns null for wrong issuer', async () => {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
    });

    const payload = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer: 'https://wrong-issuer.test',
    });

    expect(payload).toBeNull();
  });

  it('returns null for a tampered token', async () => {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
    });

    const tampered = token.slice(0, -5) + 'XXXXX';

    const payload = await verifyAccessToken({
      token: tampered,
      publicKeyPem,
      issuer: 'https://admin.takos.test',
    });

    expect(payload).toBeNull();
  });

  it('returns null for a token signed with a different key', async () => {
    const otherKeys = await jose.generateKeyPair('RS256');
    const otherPrivateKeyPem = await jose.exportPKCS8(otherKeys.privateKey);

    const { token } = await generateAccessToken({
      privateKeyPem: otherPrivateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-1',
      scope: 'openid',
    });

    const payload = await verifyAccessToken({
      token,
      publicKeyPem, // original key, not the one used to sign
      issuer: 'https://admin.takos.test',
    });

    expect(payload).toBeNull();
  });

  it('enforces audience when expectedAudience is provided', async () => {
    const { token } = await generateAccessToken({
      privateKeyPem,
      issuer: 'https://admin.takos.test',
      userId: 'user-1',
      clientId: 'client-a',
      scope: 'openid',
    });

    const correct = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer: 'https://admin.takos.test',
      expectedAudience: 'client-a',
    });
    expect(correct).not.toBeNull();

    const wrong = await verifyAccessToken({
      token,
      publicKeyPem,
      issuer: 'https://admin.takos.test',
      expectedAudience: 'client-b',
    });
    expect(wrong).toBeNull();
  });

  it('returns null for completely garbage input', async () => {
    const payload = await verifyAccessToken({
      token: 'not-a-jwt',
      publicKeyPem,
      issuer: 'https://admin.takos.test',
    });

    expect(payload).toBeNull();
  });
});

describe('generateRefreshToken', () => {
  it('returns a token string and expiry date', () => {
    const { token, expiresAt } = generateRefreshToken();

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('uses REFRESH_TOKEN_EXPIRES_IN for expiry', () => {
    const before = Date.now();
    const { expiresAt } = generateRefreshToken();
    const after = Date.now();

    const expectedMinMs = before + OAUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES_IN * 1000;
    const expectedMaxMs = after + OAUTH_CONSTANTS.REFRESH_TOKEN_EXPIRES_IN * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs + 100);
  });

  it('generates unique tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('buildAuthorizationCodeTokenFamily', () => {
  it('prefixes with auth_code:', () => {
    expect(buildAuthorizationCodeTokenFamily('code-123')).toBe('auth_code:code-123');
  });
});

describe('RefreshTokenReuseDetectedError', () => {
  it('has the correct name and message', () => {
    const error = new RefreshTokenReuseDetectedError();
    expect(error.name).toBe('RefreshTokenReuseDetectedError');
    expect(error.message).toBe('refresh_token_reuse_detected');
    expect(error).toBeInstanceOf(Error);
  });
});
