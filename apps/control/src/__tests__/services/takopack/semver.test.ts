import { describe, expect, it } from 'vitest';
import {
  parseSemver,
  compareSemver,
  parseSemverRange,
  satisfiesSemverRange,
} from '@/services/takopack/semver';

describe('parseSemver', () => {
  it('parses basic semver string', () => {
    const result = parseSemver('1.2.3');
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses version with v prefix', () => {
    expect(parseSemver('v1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] });
    expect(parseSemver('V2.3.4')).toEqual({ major: 2, minor: 3, patch: 4, prerelease: [] });
  });

  it('parses version with prerelease identifiers', () => {
    const result = parseSemver('1.2.3-alpha.1');
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['alpha', '1'] });
  });

  it('parses version with build metadata (ignored for precedence)', () => {
    const result = parseSemver('1.2.3+build.123');
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses version with both prerelease and build metadata', () => {
    const result = parseSemver('1.2.3-beta.2+build.456');
    expect(result).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['beta', '2'] });
  });

  it('returns null for invalid semver', () => {
    expect(parseSemver('')).toBeNull();
    expect(parseSemver('abc')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
    expect(parseSemver('...')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseSemver(null as unknown as string)).toBeNull();
    expect(parseSemver(undefined as unknown as string)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseSemver('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses 0.0.0', () => {
    expect(parseSemver('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: [] });
  });

  it('handles large version numbers', () => {
    const result = parseSemver('999.999.999');
    expect(result).toEqual({ major: 999, minor: 999, patch: 999, prerelease: [] });
  });
});

describe('compareSemver', () => {
  it('returns 0 for identical versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 0 for identical version strings (fast path)', () => {
    expect(compareSemver('v1.2.3', 'v1.2.3')).toBe(0);
  });

  it('compares major versions', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareSemver('1.3.0', '1.2.0')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
  });

  it('compares patch versions', () => {
    expect(compareSemver('1.2.4', '1.2.3')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
  });

  it('prerelease has lower precedence than release', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBe(1);
  });

  it('compares prerelease identifiers numerically', () => {
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
  });

  it('numeric identifiers have lower precedence than non-numeric', () => {
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-1')).toBe(1);
  });

  it('shorter prerelease has lower precedence', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
  });

  it('returns 0 for non-semver inputs', () => {
    expect(compareSemver('abc', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', 'xyz')).toBe(0);
    expect(compareSemver('abc', 'xyz')).toBe(0);
  });

  it('compares prerelease identifiers with ASCII sort for non-numeric', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBe(1);
  });
});

describe('parseSemverRange', () => {
  it('throws on empty range', () => {
    expect(() => parseSemverRange('')).toThrow('Empty version range');
  });

  it('parses exact version as = comparator', () => {
    const range = parseSemverRange('1.2.3');
    expect(range.comparators).toEqual([{ op: '=', version: '1.2.3' }]);
  });

  it('parses caret range for major > 0', () => {
    const range = parseSemverRange('^1.2.3');
    expect(range.comparators).toEqual([
      { op: '>=', version: '1.2.3' },
      { op: '<', version: '2.0.0' },
    ]);
  });

  it('parses caret range for 0.x', () => {
    const range = parseSemverRange('^0.2.3');
    expect(range.comparators).toEqual([
      { op: '>=', version: '0.2.3' },
      { op: '<', version: '0.3.0' },
    ]);
  });

  it('parses caret range for 0.0.x', () => {
    const range = parseSemverRange('^0.0.3');
    expect(range.comparators).toEqual([
      { op: '>=', version: '0.0.3' },
      { op: '<', version: '0.0.4' },
    ]);
  });

  it('parses tilde range', () => {
    const range = parseSemverRange('~1.2.3');
    expect(range.comparators).toEqual([
      { op: '>=', version: '1.2.3' },
      { op: '<', version: '1.3.0' },
    ]);
  });

  it('parses comparison operators', () => {
    expect(parseSemverRange('>=1.0.0').comparators).toEqual([{ op: '>=', version: '1.0.0' }]);
    expect(parseSemverRange('>1.0.0').comparators).toEqual([{ op: '>', version: '1.0.0' }]);
    expect(parseSemverRange('<2.0.0').comparators).toEqual([{ op: '<', version: '2.0.0' }]);
    expect(parseSemverRange('<=2.0.0').comparators).toEqual([{ op: '<=', version: '2.0.0' }]);
    expect(parseSemverRange('=1.0.0').comparators).toEqual([{ op: '=', version: '1.0.0' }]);
  });

  it('throws for invalid semver in range', () => {
    expect(() => parseSemverRange('^abc')).toThrow('Invalid semver');
  });

  it('preserves raw string', () => {
    const range = parseSemverRange('^1.2.3');
    expect(range.raw).toBe('^1.2.3');
  });
});

describe('satisfiesSemverRange', () => {
  it('satisfies exact match', () => {
    const range = parseSemverRange('1.2.3');
    expect(satisfiesSemverRange('1.2.3', range)).toBe(true);
    expect(satisfiesSemverRange('1.2.4', range)).toBe(false);
  });

  it('satisfies caret range', () => {
    const range = parseSemverRange('^1.2.3');
    expect(satisfiesSemverRange('1.2.3', range)).toBe(true);
    expect(satisfiesSemverRange('1.9.9', range)).toBe(true);
    expect(satisfiesSemverRange('2.0.0', range)).toBe(false);
    expect(satisfiesSemverRange('1.2.2', range)).toBe(false);
  });

  it('satisfies tilde range', () => {
    const range = parseSemverRange('~1.2.3');
    expect(satisfiesSemverRange('1.2.3', range)).toBe(true);
    expect(satisfiesSemverRange('1.2.9', range)).toBe(true);
    expect(satisfiesSemverRange('1.3.0', range)).toBe(false);
    expect(satisfiesSemverRange('1.2.2', range)).toBe(false);
  });

  it('satisfies >= comparison', () => {
    const range = parseSemverRange('>=1.0.0');
    expect(satisfiesSemverRange('1.0.0', range)).toBe(true);
    expect(satisfiesSemverRange('2.0.0', range)).toBe(true);
    expect(satisfiesSemverRange('0.9.9', range)).toBe(false);
  });

  it('satisfies > comparison', () => {
    const range = parseSemverRange('>1.0.0');
    expect(satisfiesSemverRange('1.0.0', range)).toBe(false);
    expect(satisfiesSemverRange('1.0.1', range)).toBe(true);
  });

  it('satisfies < comparison', () => {
    const range = parseSemverRange('<2.0.0');
    expect(satisfiesSemverRange('1.9.9', range)).toBe(true);
    expect(satisfiesSemverRange('2.0.0', range)).toBe(false);
  });

  it('satisfies <= comparison', () => {
    const range = parseSemverRange('<=2.0.0');
    expect(satisfiesSemverRange('2.0.0', range)).toBe(true);
    expect(satisfiesSemverRange('2.0.1', range)).toBe(false);
  });

  it('returns false for non-semver version', () => {
    const range = parseSemverRange('^1.0.0');
    expect(satisfiesSemverRange('abc', range)).toBe(false);
  });
});
