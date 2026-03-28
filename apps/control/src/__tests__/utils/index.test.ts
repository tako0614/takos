import { describe, expect, it } from 'vitest';
import {
  toIsoString,
  base64UrlEncode,
  base64UrlDecode,
} from '@/utils/index';

describe('toIsoString', () => {
  it('returns string as-is when given a string', () => {
    const iso = '2024-01-01T00:00:00.000Z';
    expect(toIsoString(iso)).toBe(iso);
  });

  it('converts Date to ISO string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(toIsoString(date)).toBe('2024-06-15T12:00:00.000Z');
  });

  it('returns null for null input', () => {
    expect(toIsoString(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(toIsoString(undefined)).toBeNull();
  });
});

describe('toIsoString (required overload)', () => {
  it('returns string as-is', () => {
    expect(toIsoString('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
  });

  it('converts Date to ISO string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(toIsoString(date)).toBe('2024-06-15T12:00:00.000Z');
  });
});

describe('base64UrlEncode / base64UrlDecode', () => {
  it('round-trips simple data', () => {
    const data = new TextEncoder().encode('hello world');
    const encoded = base64UrlEncode(data);
    const decoded = base64UrlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe('hello world');
  });

  it('produces URL-safe characters (no +, /, =)', () => {
    // Use data that would produce +, / in standard base64
    const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const encoded = base64UrlEncode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('round-trips empty data', () => {
    const encoded = base64UrlEncode(new Uint8Array([]));
    const decoded = base64UrlDecode(encoded);
    expect(decoded.length).toBe(0);
  });

  it('round-trips ArrayBuffer input', () => {
    const data = new TextEncoder().encode('test');
    const encoded = base64UrlEncode(data.buffer as ArrayBuffer);
    const decoded = base64UrlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe('test');
  });

  it('round-trips binary data with all byte values', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const encoded = base64UrlEncode(data);
    const decoded = base64UrlDecode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(data));
  });

  it('decode handles padding correctly', () => {
    // "a" in base64 is "YQ==" -- base64url should be "YQ"
    const decoded = base64UrlDecode('YQ');
    expect(new TextDecoder().decode(decoded)).toBe('a');
  });

  it('decode handles already-padded input', () => {
    // Some implementations pass padded base64url
    const decoded = base64UrlDecode('YQ==');
    expect(new TextDecoder().decode(decoded)).toBe('a');
  });
});
