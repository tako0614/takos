import { describe, expect, it } from 'vitest';
import { compareSemver, getUpdateType } from '../store-install.js';

// ── compareSemver ───────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns -1 when a < b (minor)', () => {
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns 0 when versions are equal', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns -1 when a < b (patch)', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
  });

  it('returns 1 when a > b (patch)', () => {
    expect(compareSemver('1.0.2', '1.0.1')).toBe(1);
  });

  it('handles v prefix', () => {
    expect(compareSemver('v1.0.0', 'v1.1.0')).toBe(-1);
    expect(compareSemver('v2.0.0', '1.0.0')).toBe(1);
    expect(compareSemver('1.0.0', 'v1.0.0')).toBe(0);
  });

  it('throws on invalid semver', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow('Invalid semver');
    expect(() => compareSemver('abc', '1.0.0')).toThrow('Invalid semver');
    expect(() => compareSemver('1.0.0', '')).toThrow('Invalid semver');
  });

  it('compares multi-digit version numbers', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('1.0.10', '1.0.9')).toBe(1);
    expect(compareSemver('10.0.0', '9.0.0')).toBe(1);
  });
});

// ── getUpdateType ───────────────────────────────────────────────────────────

describe('getUpdateType', () => {
  it('detects patch update', () => {
    expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
  });

  it('detects minor update', () => {
    expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
  });

  it('detects major update', () => {
    expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
  });

  it('detects major even when minor/patch also change', () => {
    expect(getUpdateType('1.2.3', '2.0.0')).toBe('major');
    expect(getUpdateType('1.0.0', '3.5.2')).toBe('major');
  });

  it('detects minor even when patch also changes', () => {
    expect(getUpdateType('1.0.0', '1.2.5')).toBe('minor');
  });

  it('handles v prefix', () => {
    expect(getUpdateType('v1.0.0', 'v1.0.1')).toBe('patch');
    expect(getUpdateType('v1.0.0', 'v2.0.0')).toBe('major');
  });
});
