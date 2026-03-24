import { describe, expect, it } from 'vitest';
import { isLocalhost, isPrivateIP } from '../src/validation.js';

describe('isLocalhost', () => {
  it('returns true for localhost', () => {
    expect(isLocalhost('localhost')).toBe(true);
  });

  it('returns true for 127.0.0.1', () => {
    expect(isLocalhost('127.0.0.1')).toBe(true);
  });

  it('returns true for ::1', () => {
    expect(isLocalhost('::1')).toBe(true);
  });

  it('returns true for .localhost suffix', () => {
    expect(isLocalhost('app.localhost')).toBe(true);
  });

  it('returns false for public hostnames', () => {
    expect(isLocalhost('example.com')).toBe(false);
  });
});

describe('isPrivateIP', () => {
  it('returns true for 10.x.x.x', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
  });

  it('returns true for 192.168.x.x', () => {
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  it('returns true for 172.16-31.x.x', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
  });

  it('returns false for public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
  });
});
