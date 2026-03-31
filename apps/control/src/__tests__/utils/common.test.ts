import { buildDurableObjectUrl, extractBearerToken } from '@/utils/common';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('buildDurableObjectUrl - prepends internal origin to path with leading slash', () => {
  assertEquals(buildDurableObjectUrl('/api/v1'), 'https://internal.do/api/v1');
})
  Deno.test('buildDurableObjectUrl - adds leading slash when missing', () => {
  assertEquals(buildDurableObjectUrl('api/v1'), 'https://internal.do/api/v1');
})
  Deno.test('buildDurableObjectUrl - handles root path', () => {
  assertEquals(buildDurableObjectUrl('/'), 'https://internal.do/');
})
  Deno.test('buildDurableObjectUrl - handles empty string', () => {
  assertEquals(buildDurableObjectUrl(''), 'https://internal.do/');
})
  Deno.test('buildDurableObjectUrl - preserves query parameters', () => {
  assertEquals(buildDurableObjectUrl('/path?foo=bar'), 'https://internal.do/path?foo=bar');
})
  Deno.test('buildDurableObjectUrl - preserves double slashes in path body', () => {
  assertEquals(buildDurableObjectUrl('/a//b'), 'https://internal.do/a//b');
})

  Deno.test('extractBearerToken - extracts token from valid Bearer header', () => {
  assertEquals(extractBearerToken('Bearer abc123'), 'abc123');
})
  Deno.test('extractBearerToken - trims whitespace from extracted token', () => {
  assertEquals(extractBearerToken('Bearer   token-with-spaces   '), 'token-with-spaces');
})
  Deno.test('extractBearerToken - returns null for undefined header', () => {
  assertEquals(extractBearerToken(undefined), null);
})
  Deno.test('extractBearerToken - returns null for null header', () => {
  assertEquals(extractBearerToken(null), null);
})
  Deno.test('extractBearerToken - returns null for empty string', () => {
  assertEquals(extractBearerToken(''), null);
})
  Deno.test('extractBearerToken - returns null for non-Bearer auth scheme', () => {
  assertEquals(extractBearerToken('Basic abc123'), null);
})
  Deno.test('extractBearerToken - returns null for lowercase bearer', () => {
  // The implementation checks startsWith("Bearer ") which is case-sensitive
    assertEquals(extractBearerToken('bearer abc123'), null);
})
  Deno.test('extractBearerToken - returns null for "Bearer " with empty token', () => {
  assertEquals(extractBearerToken('Bearer '), null);
})
  Deno.test('extractBearerToken - returns null for "Bearer" without space', () => {
  assertEquals(extractBearerToken('Bearerabc123'), null);
})
  Deno.test('extractBearerToken - handles JWT-like tokens', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abc123';
    assertEquals(extractBearerToken(`Bearer ${jwt}`), jwt);
})