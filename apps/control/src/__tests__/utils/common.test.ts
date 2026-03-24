import { describe, expect, it } from 'vitest';
import { buildDurableObjectUrl, extractBearerToken } from '@/utils/common';

describe('buildDurableObjectUrl', () => {
  it('prepends internal origin to path with leading slash', () => {
    expect(buildDurableObjectUrl('/api/v1')).toBe('https://internal.do/api/v1');
  });

  it('adds leading slash when missing', () => {
    expect(buildDurableObjectUrl('api/v1')).toBe('https://internal.do/api/v1');
  });

  it('handles root path', () => {
    expect(buildDurableObjectUrl('/')).toBe('https://internal.do/');
  });

  it('handles empty string', () => {
    expect(buildDurableObjectUrl('')).toBe('https://internal.do/');
  });

  it('preserves query parameters', () => {
    expect(buildDurableObjectUrl('/path?foo=bar')).toBe('https://internal.do/path?foo=bar');
  });

  it('preserves double slashes in path body', () => {
    expect(buildDurableObjectUrl('/a//b')).toBe('https://internal.do/a//b');
  });
});

describe('extractBearerToken', () => {
  it('extracts token from valid Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('trims whitespace from extracted token', () => {
    expect(extractBearerToken('Bearer   token-with-spaces   ')).toBe('token-with-spaces');
  });

  it('returns null for undefined header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for null header', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  it('returns null for non-Bearer auth scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null for lowercase bearer', () => {
    // The implementation checks startsWith("Bearer ") which is case-sensitive
    expect(extractBearerToken('bearer abc123')).toBeNull();
  });

  it('returns null for "Bearer " with empty token', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });

  it('returns null for "Bearer" without space', () => {
    expect(extractBearerToken('Bearerabc123')).toBeNull();
  });

  it('handles JWT-like tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abc123';
    expect(extractBearerToken(`Bearer ${jwt}`)).toBe(jwt);
  });
});
