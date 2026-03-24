import { describe, it, expect } from 'vitest';
import { isValidRefName } from '@/services/git-smart/core/refs';

describe('isValidRefName', () => {
  describe('valid ref names', () => {
    it.each([
      'main',
      'feature/branch',
      'release-1.0',
      'a',
    ])('accepts "%s"', (name) => {
      expect(isValidRefName(name)).toBe(true);
    });
  });

  describe('invalid ref names', () => {
    it('rejects empty string', () => {
      expect(isValidRefName('')).toBe(false);
    });

    it('rejects string exceeding 255 chars', () => {
      const longName = 'a'.repeat(256);
      expect(isValidRefName(longName)).toBe(false);
    });

    it('accepts string exactly at 255 chars', () => {
      const maxName = 'a'.repeat(255);
      expect(isValidRefName(maxName)).toBe(true);
    });

    it('rejects name containing ".."', () => {
      expect(isValidRefName('foo..bar')).toBe(false);
    });

    it('rejects name containing "~"', () => {
      expect(isValidRefName('foo~bar')).toBe(false);
    });

    it('rejects name containing "^"', () => {
      expect(isValidRefName('foo^bar')).toBe(false);
    });

    it('rejects name containing ":"', () => {
      expect(isValidRefName('foo:bar')).toBe(false);
    });

    it('rejects name containing "?"', () => {
      expect(isValidRefName('foo?bar')).toBe(false);
    });

    it('rejects name containing "*"', () => {
      expect(isValidRefName('foo*bar')).toBe(false);
    });

    it('rejects name containing "["', () => {
      expect(isValidRefName('foo[bar')).toBe(false);
    });

    it('rejects name containing "\\"', () => {
      expect(isValidRefName('foo\\bar')).toBe(false);
    });

    it('rejects name ending with ".lock"', () => {
      expect(isValidRefName('branch.lock')).toBe(false);
    });

    it('rejects name ending with "."', () => {
      expect(isValidRefName('branch.')).toBe(false);
    });

    it('rejects name starting with "/"', () => {
      expect(isValidRefName('/branch')).toBe(false);
    });

    it('rejects name ending with "/"', () => {
      expect(isValidRefName('branch/')).toBe(false);
    });

    it('rejects name containing "//"', () => {
      expect(isValidRefName('foo//bar')).toBe(false);
    });

    it('rejects name containing "@{"', () => {
      expect(isValidRefName('foo@{bar')).toBe(false);
    });

    it('rejects non-ASCII characters', () => {
      expect(isValidRefName('branch-\u00e9')).toBe(false);
    });

    it('rejects null', () => {
      expect(isValidRefName(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidRefName(undefined)).toBe(false);
    });

    it('rejects number', () => {
      expect(isValidRefName(42)).toBe(false);
    });
  });
});
