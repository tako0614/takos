import { describe, expect, it } from 'vitest';
import {
  generateVerificationToken,
  generateDomainId,
  isValidDomain,
  normalizeDomain,
} from '@/utils/domains';

describe('generateVerificationToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateVerificationToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different tokens each call', () => {
    const t1 = generateVerificationToken();
    const t2 = generateVerificationToken();
    expect(t1).not.toBe(t2);
  });
});

describe('generateDomainId', () => {
  it('starts with "dom_" prefix', () => {
    const id = generateDomainId();
    expect(id.startsWith('dom_')).toBe(true);
  });

  it('has correct total length (4 prefix + 32 hex chars)', () => {
    const id = generateDomainId();
    expect(id).toHaveLength(4 + 32);
  });

  it('hex portion is valid hex', () => {
    const id = generateDomainId();
    const hex = id.slice(4);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique IDs', () => {
    const id1 = generateDomainId();
    const id2 = generateDomainId();
    expect(id1).not.toBe(id2);
  });
});

describe('isValidDomain', () => {
  it('accepts a valid two-label domain', () => {
    expect(isValidDomain('example.com')).toBe(true);
  });

  it('accepts a valid multi-label domain', () => {
    expect(isValidDomain('sub.example.com')).toBe(true);
  });

  it('accepts domains with trailing dot (FQDN)', () => {
    expect(isValidDomain('example.com.')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidDomain('')).toBe(false);
  });

  it('rejects single-label domain (no dots)', () => {
    expect(isValidDomain('localhost')).toBe(false);
  });

  it('rejects domain exceeding 253 characters', () => {
    const long = 'a'.repeat(250) + '.com';
    expect(isValidDomain(long)).toBe(false);
  });

  it('rejects label exceeding 63 characters', () => {
    const longLabel = 'a'.repeat(64) + '.com';
    expect(isValidDomain(longLabel)).toBe(false);
  });

  it('accepts label at exactly 63 characters', () => {
    const maxLabel = 'a'.repeat(63) + '.com';
    expect(isValidDomain(maxLabel)).toBe(true);
  });

  it('rejects empty label (consecutive dots)', () => {
    expect(isValidDomain('example..com')).toBe(false);
  });

  it('rejects label starting with hyphen', () => {
    expect(isValidDomain('-example.com')).toBe(false);
  });

  it('rejects label ending with hyphen', () => {
    expect(isValidDomain('example-.com')).toBe(false);
  });

  it('accepts label with hyphens in the middle', () => {
    expect(isValidDomain('my-example.com')).toBe(true);
  });

  it('rejects label with underscores', () => {
    expect(isValidDomain('my_example.com')).toBe(false);
  });

  it('rejects domain with spaces', () => {
    expect(isValidDomain('my domain.com')).toBe(false);
  });

  it('accepts numeric labels', () => {
    expect(isValidDomain('123.456')).toBe(true);
  });

  it('accepts mixed case (labels are case-insensitive)', () => {
    expect(isValidDomain('Example.COM')).toBe(true);
  });
});

describe('normalizeDomain', () => {
  it('lowercases the domain', () => {
    expect(normalizeDomain('EXAMPLE.COM')).toBe('example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('removes trailing dots', () => {
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });

  it('removes multiple trailing dots', () => {
    expect(normalizeDomain('example.com...')).toBe('example.com');
  });

  it('handles combined normalization', () => {
    expect(normalizeDomain('  Example.COM.  ')).toBe('example.com');
  });
});
