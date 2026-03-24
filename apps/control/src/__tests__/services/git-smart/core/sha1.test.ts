import { describe, it, expect } from 'vitest';
import { sha1, hexFromBuffer, hexToBytes, concatBytes } from '@/services/git-smart/core/sha1';

describe('sha1', () => {
  it('hashes empty blob to known value', async () => {
    // git hash-object -t blob --stdin < /dev/null → e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
    const data = new TextEncoder().encode('blob 0\0');
    const hash = await sha1(data);
    expect(hash).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('hashes non-empty data deterministically', async () => {
    const data = new TextEncoder().encode('hello');
    const hash1 = await sha1(data);
    const hash2 = await sha1(data);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('hexFromBuffer / hexToBytes roundtrip', () => {
  it('converts buffer to hex and back', () => {
    const original = new Uint8Array([0x00, 0xff, 0xab, 0x12, 0x34]);
    const hex = hexFromBuffer(original.buffer as ArrayBuffer);
    expect(hex).toBe('00ffab1234');
    const bytes = hexToBytes(hex);
    expect(bytes).toEqual(original);
  });

  it('handles a full SHA-1 hex string', () => {
    const hex = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
    const bytes = hexToBytes(hex);
    expect(bytes.length).toBe(20);
    const roundtrip = hexFromBuffer(bytes.buffer as ArrayBuffer);
    expect(roundtrip).toBe(hex);
  });
});

describe('concatBytes', () => {
  it('returns empty Uint8Array for 0 arguments', () => {
    const result = concatBytes();
    expect(result).toEqual(new Uint8Array(0));
    expect(result.length).toBe(0);
  });

  it('returns copy of single array', () => {
    const a = new Uint8Array([1, 2, 3]);
    const result = concatBytes(a);
    expect(result).toEqual(a);
    // Should be a different instance
    a[0] = 99;
    expect(result[0]).toBe(1);
  });

  it('concatenates multiple arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    const result = concatBytes(a, b, c);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });
});
