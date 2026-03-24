import { describe, expect, it } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  isValidCodeVerifier,
  isValidCodeChallenge,
  generateRandomString,
  generateId,
} from '@/services/oauth/pkce';

describe('generateCodeVerifier', () => {
  it('produces a base64url-encoded string', () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    // base64url characters only
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique verifiers', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('generateCodeChallenge', () => {
  it('produces a 43-character base64url challenge for S256', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier, 'S256');
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different challenges for different verifiers', async () => {
    const a = await generateCodeChallenge('verifier-aaa', 'S256');
    const b = await generateCodeChallenge('verifier-bbb', 'S256');
    expect(a).not.toBe(b);
  });

  it('produces the same challenge for the same verifier (deterministic)', async () => {
    const verifier = 'deterministic-test-verifier-1234567890abcdef';
    const a = await generateCodeChallenge(verifier, 'S256');
    const b = await generateCodeChallenge(verifier, 'S256');
    expect(a).toBe(b);
  });

  it('throws for unsupported methods', async () => {
    await expect(generateCodeChallenge('verifier', 'plain' as never)).rejects.toThrow(
      'Unsupported PKCE code challenge method',
    );
  });
});

describe('verifyCodeChallenge', () => {
  it('returns true when verifier matches the challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier, 'S256');
    const result = await verifyCodeChallenge(verifier, challenge, 'S256');
    expect(result).toBe(true);
  });

  it('returns false when verifier does not match', async () => {
    const challenge = await generateCodeChallenge('correct-verifier-1234567890abcd', 'S256');
    const result = await verifyCodeChallenge('wrong-verifier-1234567890abcdef', challenge, 'S256');
    expect(result).toBe(false);
  });

  it('uses S256 as default method', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const result = await verifyCodeChallenge(verifier, challenge);
    expect(result).toBe(true);
  });
});

describe('isValidCodeVerifier', () => {
  it('accepts verifiers between 43 and 128 characters', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(80))).toBe(true);
  });

  it('rejects verifiers shorter than 43 characters', () => {
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('')).toBe(false);
  });

  it('rejects verifiers longer than 128 characters', () => {
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
  });

  it('accepts unreserved URI characters: alphanumeric, hyphen, period, underscore, tilde', () => {
    expect(isValidCodeVerifier('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq')).toBe(true);
    expect(isValidCodeVerifier('0123456789-._~' + 'a'.repeat(29))).toBe(true);
  });

  it('rejects verifiers with invalid characters', () => {
    expect(isValidCodeVerifier('a'.repeat(43) + '!')).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43) + ' ')).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43) + '+')).toBe(false);
  });
});

describe('isValidCodeChallenge', () => {
  it('accepts exactly 43 character base64url strings', () => {
    expect(isValidCodeChallenge('A'.repeat(43))).toBe(true);
    expect(isValidCodeChallenge('abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE')).toBe(true);
  });

  it('rejects challenges that are not exactly 43 characters', () => {
    expect(isValidCodeChallenge('A'.repeat(42))).toBe(false);
    expect(isValidCodeChallenge('A'.repeat(44))).toBe(false);
    expect(isValidCodeChallenge('')).toBe(false);
  });

  it('rejects challenges with non-base64url characters', () => {
    expect(isValidCodeChallenge('A'.repeat(42) + '+')).toBe(false);
    expect(isValidCodeChallenge('A'.repeat(42) + '=')).toBe(false);
    expect(isValidCodeChallenge('A'.repeat(42) + '/')).toBe(false);
  });
});

describe('generateRandomString', () => {
  it('produces a base64url-encoded string', () => {
    const str = generateRandomString(32);
    expect(typeof str).toBe('string');
    expect(str).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique strings', () => {
    const a = generateRandomString(32);
    const b = generateRandomString(32);
    expect(a).not.toBe(b);
  });
});

describe('generateId', () => {
  it('produces a UUID-like string', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
