/**
 * Tests for executor-proxy-config: proxy token generation.
 *
 * Basic tests live in test/executor-dispatch.test.ts.
 * This file adds additional coverage for token properties.
 */
import { generateProxyToken } from '@/container-hosts/executor-proxy-config';


import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

  Deno.test('generateProxyToken - returns a base64url-encoded string without padding', () => {
  const token = generateProxyToken();
    assert(/^[A-Za-z0-9_-]+$/.test(token));
    // No padding characters
    assert(!(token).includes('='));
    assert(!(token).includes('+'));
    assert(!(token).includes('/'));
})
  Deno.test('generateProxyToken - generates tokens of consistent length (~43 chars for 32 bytes)', () => {
  // 32 bytes -> 44 base64 chars, minus padding -> ~43 chars
    const token = generateProxyToken();
    assert(token.length >= 42);
    assert(token.length <= 44);
})
  Deno.test('generateProxyToken - generates unique tokens', () => {
  const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateProxyToken());
    }
    // All 100 should be unique
    assertEquals(tokens.size, 100);
})
  Deno.test('generateProxyToken - produces cryptographically random output', () => {
  const token1 = generateProxyToken();
    const token2 = generateProxyToken();
    // Extremely unlikely to share a prefix
    assertNotEquals(token1.substring(0, 10), token2.substring(0, 10));
})