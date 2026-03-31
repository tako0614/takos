// Mock config and api dependencies before importing modules
import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert';

const mocks = ({
  getConfig: ((..._args: any[]) => undefined) as any,
  getApiRequestTimeoutMs: ((..._args: any[]) => undefined) as any,
  createAuthHeaders: ((..._args: any[]) => undefined) as any,
  cliExit: (code?: number) => {
    throw new Error(`cliExit:${code ?? 0}`);
  },
});

// [Deno] vi.mock removed - manually stub imports from '../src/lib/config.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/api.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/command-exit.ts'
// Test only the pure functions that can be imported independently
import {
  parseSseEventBlock,
  toWebSocketUrl,
  tryParseJson,
} from '../src/commands/api-request.ts';

// ---------------------------------------------------------------------------
// SSE stream parsing edge cases
// ---------------------------------------------------------------------------


  Deno.test('SSE stream parsing edge cases - handles CRLF line endings in block', () => {
  const block = 'event: update\r\ndata: hello\r\nid: 1';
    // parseSseEventBlock splits on \n, so \r stays in values
    const result = parseSseEventBlock(block);
    assertNotEquals(result, null);
    // The function splits on \n, so \r may remain in some fields
    assertStringIncludes(result!.event, 'update');
})
  Deno.test('SSE stream parsing edge cases - handles data line with no space after colon', () => {
  const block = 'data:nospace';
    const result = parseSseEventBlock(block);
    assertEquals(result?.data, 'nospace');
})
  Deno.test('SSE stream parsing edge cases - handles empty data line', () => {
  const block = 'data: ';
    const result = parseSseEventBlock(block);
    assertEquals(result?.data, '');
})
  Deno.test('SSE stream parsing edge cases - handles multiple event fields (last one wins)', () => {
  const block = 'event: first\nevent: second\ndata: test';
    const result = parseSseEventBlock(block);
    assertEquals(result?.event, 'second');
})
  Deno.test('SSE stream parsing edge cases - handles retry with zero value', () => {
  const block = 'retry: 0\ndata: test';
    const result = parseSseEventBlock(block);
    assertEquals(result?.retry, 0);
})
  Deno.test('SSE stream parsing edge cases - handles retry with float value (not integer)', () => {
  const block = 'retry: 1.5\ndata: test';
    const result = parseSseEventBlock(block);
    assertEquals(result?.retry, undefined);
})
// ---------------------------------------------------------------------------
// WebSocket URL conversion edge cases
// ---------------------------------------------------------------------------


  Deno.test('toWebSocketUrl edge cases - preserves port in conversion', () => {
  const result = toWebSocketUrl(new URL('https://localhost:3000/api'));
    assertEquals(result.port, '3000');
    assertEquals(result.protocol, 'wss:');
})
  Deno.test('toWebSocketUrl edge cases - preserves hash fragment', () => {
  const result = toWebSocketUrl(new URL('https://takos.jp/api#fragment'));
    assertEquals(result.hash, '#fragment');
})
  Deno.test('toWebSocketUrl edge cases - handles URL with no path', () => {
  const result = toWebSocketUrl(new URL('https://takos.jp'));
    assertEquals(result.protocol, 'wss:');
    assertEquals(result.pathname, '/');
})
// ---------------------------------------------------------------------------
// tryParseJson edge cases
// ---------------------------------------------------------------------------


  Deno.test('tryParseJson edge cases - parses boolean true', () => {
  assertEquals(tryParseJson('true'), true);
})
  Deno.test('tryParseJson edge cases - parses boolean false', () => {
  assertEquals(tryParseJson('false'), false);
})
  Deno.test('tryParseJson edge cases - returns string for partial JSON', () => {
  assertEquals(tryParseJson('{"incomplete'), '{"incomplete');
})
  Deno.test('tryParseJson edge cases - parses nested object', () => {
  const result = tryParseJson('{"a":{"b":"c"}}');
    assertEquals(result, { a: { b: 'c' } });
})
  Deno.test('tryParseJson edge cases - parses JSON string literal', () => {
  assertEquals(tryParseJson('"hello"'), 'hello');
})