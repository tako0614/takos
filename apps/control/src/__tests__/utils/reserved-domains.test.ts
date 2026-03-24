import { describe, expect, it } from 'vitest';
import {
  RESERVED_SUBDOMAINS,
  isReservedSubdomain,
  hasReservedSubdomain,
  isDomainReserved,
} from '@/utils/reserved-domains';

describe('RESERVED_SUBDOMAINS', () => {
  it('is a non-empty Set', () => {
    expect(RESERVED_SUBDOMAINS).toBeInstanceOf(Set);
    expect(RESERVED_SUBDOMAINS.size).toBeGreaterThan(0);
  });

  it('contains admin subdomains', () => {
    expect(RESERVED_SUBDOMAINS.has('admin')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('root')).toBe(true);
  });

  it('contains API subdomains', () => {
    expect(RESERVED_SUBDOMAINS.has('api')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('graphql')).toBe(true);
  });

  it('contains web subdomains', () => {
    expect(RESERVED_SUBDOMAINS.has('www')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('www1')).toBe(true);
  });

  it('contains brand protection', () => {
    expect(RESERVED_SUBDOMAINS.has('takos')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('yurucommu')).toBe(true);
  });

  it('contains infrastructure subdomains', () => {
    expect(RESERVED_SUBDOMAINS.has('cdn')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('static')).toBe(true);
    expect(RESERVED_SUBDOMAINS.has('mail')).toBe(true);
  });
});

describe('isReservedSubdomain', () => {
  it('returns true for reserved subdomain', () => {
    expect(isReservedSubdomain('admin')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReservedSubdomain('Admin')).toBe(true);
    expect(isReservedSubdomain('ADMIN')).toBe(true);
  });

  it('returns false for non-reserved subdomain', () => {
    expect(isReservedSubdomain('mycompany')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isReservedSubdomain('')).toBe(false);
  });
});

describe('hasReservedSubdomain', () => {
  it('returns true when first label is reserved', () => {
    expect(hasReservedSubdomain('admin.example.com')).toBe(true);
  });

  it('returns false when first label is not reserved', () => {
    expect(hasReservedSubdomain('mysite.example.com')).toBe(false);
  });

  it('only checks the first label', () => {
    expect(hasReservedSubdomain('mysite.admin.com')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasReservedSubdomain('API.example.com')).toBe(true);
  });

  it('handles single-label domain', () => {
    // First label of "admin" is "admin" itself
    expect(hasReservedSubdomain('admin')).toBe(true);
  });
});

describe('isDomainReserved', () => {
  const baseDomain = 'takos.jp';

  it('returns true for the platform domain itself', () => {
    expect(isDomainReserved('takos.jp', baseDomain)).toBe(true);
  });

  it('returns true for subdomains of platform domain', () => {
    expect(isDomainReserved('anything.takos.jp', baseDomain)).toBe(true);
    expect(isDomainReserved('sub.anything.takos.jp', baseDomain)).toBe(true);
  });

  it('returns true for domains with reserved first label', () => {
    expect(isDomainReserved('admin.example.com', baseDomain)).toBe(true);
    expect(isDomainReserved('api.example.com', baseDomain)).toBe(true);
  });

  it('returns false for non-reserved external domains', () => {
    expect(isDomainReserved('mysite.example.com', baseDomain)).toBe(false);
  });

  it('handles case-insensitive comparison', () => {
    expect(isDomainReserved('TAKOS.JP', baseDomain)).toBe(true);
    expect(isDomainReserved('Admin.Example.COM', baseDomain)).toBe(true);
  });

  it('handles trailing dots', () => {
    expect(isDomainReserved('takos.jp.', baseDomain)).toBe(true);
  });

  it('handles whitespace', () => {
    expect(isDomainReserved('  takos.jp  ', baseDomain)).toBe(true);
  });

  it('returns false for domains that merely contain the base domain string', () => {
    // "not-takos.jp" should not match as a subdomain of "takos.jp"
    expect(isDomainReserved('not-takos.jp', baseDomain)).toBe(false);
  });
});
