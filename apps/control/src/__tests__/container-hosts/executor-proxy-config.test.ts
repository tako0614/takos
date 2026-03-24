/**
 * Tests for executor-proxy-config: proxy token generation.
 *
 * Basic tests live in test/executor-dispatch.test.ts.
 * This file adds additional coverage for token properties.
 */
import { describe, expect, it } from 'vitest';

import { generateProxyToken } from '@/container-hosts/executor-proxy-config';

describe('generateProxyToken', () => {
  it('returns a base64url-encoded string without padding', () => {
    const token = generateProxyToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // No padding characters
    expect(token).not.toContain('=');
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
  });

  it('generates tokens of consistent length (~43 chars for 32 bytes)', () => {
    // 32 bytes -> 44 base64 chars, minus padding -> ~43 chars
    const token = generateProxyToken();
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(token.length).toBeLessThanOrEqual(44);
  });

  it('generates unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateProxyToken());
    }
    // All 100 should be unique
    expect(tokens.size).toBe(100);
  });

  it('produces cryptographically random output', () => {
    const token1 = generateProxyToken();
    const token2 = generateProxyToken();
    // Extremely unlikely to share a prefix
    expect(token1.substring(0, 10)).not.toBe(token2.substring(0, 10));
  });
});
