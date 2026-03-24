import { describe, expect, it } from 'vitest';
import {
  validateApiUrl,
  isLocalhostAddress,
  isValidId,
} from '../src/lib/config-validation.js';

// ---------------------------------------------------------------------------
// isLocalhostAddress
// ---------------------------------------------------------------------------

describe('isLocalhostAddress', () => {
  it('recognizes "localhost"', () => {
    expect(isLocalhostAddress('localhost')).toBe(true);
  });

  it('recognizes "LOCALHOST" (case-insensitive)', () => {
    expect(isLocalhostAddress('LOCALHOST')).toBe(true);
  });

  it('recognizes 127.0.0.1', () => {
    expect(isLocalhostAddress('127.0.0.1')).toBe(true);
  });

  it('recognizes 127.10.20.30 (loopback range)', () => {
    expect(isLocalhostAddress('127.10.20.30')).toBe(true);
  });

  it('recognizes IPv6 loopback ::1', () => {
    expect(isLocalhostAddress('::1')).toBe(true);
  });

  it('recognizes full IPv6 loopback', () => {
    expect(isLocalhostAddress('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('recognizes bracketed IPv6', () => {
    expect(isLocalhostAddress('[::1]')).toBe(true);
  });

  it('rejects non-localhost IPs', () => {
    expect(isLocalhostAddress('192.168.1.1')).toBe(false);
  });

  it('rejects domain names', () => {
    expect(isLocalhostAddress('example.com')).toBe(false);
  });

  it('rejects 128.0.0.1 (not loopback)', () => {
    expect(isLocalhostAddress('128.0.0.1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isLocalhostAddress('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateApiUrl
// ---------------------------------------------------------------------------

describe('validateApiUrl', () => {
  it('accepts HTTPS on takos.jp', () => {
    const result = validateApiUrl('https://takos.jp');
    expect(result).toEqual({ valid: true });
  });

  it('accepts HTTPS on takos.dev', () => {
    const result = validateApiUrl('https://api.takos.dev');
    expect(result).toEqual({ valid: true });
  });

  it('accepts HTTPS on takos.io', () => {
    const result = validateApiUrl('https://takos.io');
    expect(result).toEqual({ valid: true });
  });

  it('accepts HTTPS on yurucommu.com', () => {
    const result = validateApiUrl('https://api.yurucommu.com');
    expect(result).toEqual({ valid: true });
  });

  it('accepts subdomain of allowed domain', () => {
    const result = validateApiUrl('https://sub.domain.takos.jp');
    expect(result).toEqual({ valid: true });
  });

  it('rejects HTTP on non-localhost domain', () => {
    const result = validateApiUrl('http://takos.jp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTPS');
  });

  it('rejects disallowed domain', () => {
    const result = validateApiUrl('https://example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('domain must be one of');
  });

  it('allows localhost HTTP and marks as insecure', () => {
    const result = validateApiUrl('http://localhost:8787');
    expect(result.valid).toBe(true);
    expect(result.insecureLocalhostHttp).toBe(true);
  });

  it('allows 127.0.0.1 HTTP and marks as insecure', () => {
    const result = validateApiUrl('http://127.0.0.1:3000');
    expect(result.valid).toBe(true);
    expect(result.insecureLocalhostHttp).toBe(true);
  });

  it('accepts HTTPS on localhost', () => {
    const result = validateApiUrl('https://localhost:8787');
    expect(result.valid).toBe(true);
    expect(result.insecureLocalhostHttp).toBeUndefined();
  });

  it('rejects URLs with embedded credentials', () => {
    const result = validateApiUrl('https://user:pass@takos.jp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('credentials');
  });

  it('rejects URL with only username', () => {
    const result = validateApiUrl('https://user@takos.jp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('credentials');
  });

  it('rejects invalid URL format', () => {
    const result = validateApiUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid API URL format');
  });

  it('rejects FTP on non-localhost', () => {
    const result = validateApiUrl('ftp://takos.jp');
    expect(result.valid).toBe(false);
  });

  it('rejects empty string', () => {
    const result = validateApiUrl('');
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidId
// ---------------------------------------------------------------------------

describe('isValidId', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts UUID v4 (uppercase)', () => {
    expect(isValidId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('accepts a simple alphanumeric ID', () => {
    expect(isValidId('ws-demo')).toBe(true);
  });

  it('accepts single character ID', () => {
    expect(isValidId('a')).toBe(true);
  });

  it('accepts ID with underscore', () => {
    expect(isValidId('my_workspace_123')).toBe(true);
  });

  it('accepts ID with hyphen', () => {
    expect(isValidId('my-workspace-123')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('rejects ID with special characters', () => {
    expect(isValidId('ws!@#$%')).toBe(false);
  });

  it('rejects ID exceeding 64 characters', () => {
    expect(isValidId('a'.repeat(65))).toBe(false);
  });

  it('accepts ID at exactly 64 characters', () => {
    expect(isValidId('a'.repeat(64))).toBe(true);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime behavior with wrong type
    expect(isValidId(123)).toBe(false);
  });

  it('respects custom minLength', () => {
    expect(isValidId('ab', 3)).toBe(false);
    expect(isValidId('abc', 3)).toBe(true);
  });

  it('rejects ID with spaces', () => {
    expect(isValidId('has space')).toBe(false);
  });

  it('rejects ID with dots', () => {
    expect(isValidId('has.dot')).toBe(false);
  });
});
