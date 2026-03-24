import { describe, expect, it } from 'vitest';
import { computeSHA256, verifyBundleHash, constantTimeEqual } from '@/utils/hash';

describe('computeSHA256', () => {
  it('hashes a string to a 64-char hex string', async () => {
    const hash = await computeSHA256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns known SHA-256 for empty string', async () => {
    const hash = await computeSHA256('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns known SHA-256 for "hello"', async () => {
    const hash = await computeSHA256('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hashes Uint8Array input', async () => {
    const data = new TextEncoder().encode('hello');
    const hash = await computeSHA256(data);
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hashes ArrayBuffer input', async () => {
    const data = new TextEncoder().encode('hello').buffer;
    const hash = await computeSHA256(data as ArrayBuffer);
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await computeSHA256('abc');
    const h2 = await computeSHA256('def');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyBundleHash', () => {
  it('returns true when hash matches', async () => {
    const content = 'test content';
    const hash = await computeSHA256(content);
    expect(await verifyBundleHash(content, hash)).toBe(true);
  });

  it('returns false when hash does not match', async () => {
    expect(await verifyBundleHash('test', 'wrong-hash')).toBe(false);
  });

  it('works with ArrayBuffer content', async () => {
    const content = new TextEncoder().encode('test content');
    const hash = await computeSHA256(content);
    expect(await verifyBundleHash(content.buffer as ArrayBuffer, hash)).toBe(true);
  });

  it('rejects tampered content', async () => {
    const hash = await computeSHA256('original');
    expect(await verifyBundleHash('tampered', hash)).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different length strings', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false when comparing empty to non-empty', () => {
    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual('a', '')).toBe(false);
  });

  it('returns false for strings differing only in last char', () => {
    expect(constantTimeEqual('abcde', 'abcdf')).toBe(false);
  });

  it('returns false for strings differing only in first char', () => {
    expect(constantTimeEqual('xbcde', 'abcde')).toBe(false);
  });
});
