import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock config and api dependencies before importing modules
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getApiRequestTimeoutMs: vi.fn(),
  createAuthHeaders: vi.fn(),
  cliExit: vi.fn((code?: number) => {
    throw new Error(`cliExit:${code ?? 0}`);
  }),
}));

vi.mock('../src/lib/config.js', () => ({
  getConfig: mocks.getConfig,
  getApiRequestTimeoutMs: mocks.getApiRequestTimeoutMs,
}));

vi.mock('../src/lib/api.js', () => ({
  createAuthHeaders: mocks.createAuthHeaders,
}));

vi.mock('../src/lib/command-exit.js', () => ({
  cliExit: mocks.cliExit,
}));

// Test only the pure functions that can be imported independently
import {
  parseSseEventBlock,
  toWebSocketUrl,
  tryParseJson,
} from '../src/commands/api-request.js';

// ---------------------------------------------------------------------------
// SSE stream parsing edge cases
// ---------------------------------------------------------------------------

describe('SSE stream parsing edge cases', () => {
  it('handles CRLF line endings in block', () => {
    const block = 'event: update\r\ndata: hello\r\nid: 1';
    // parseSseEventBlock splits on \n, so \r stays in values
    const result = parseSseEventBlock(block);
    expect(result).not.toBeNull();
    // The function splits on \n, so \r may remain in some fields
    expect(result!.event).toContain('update');
  });

  it('handles data line with no space after colon', () => {
    const block = 'data:nospace';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBe('nospace');
  });

  it('handles empty data line', () => {
    const block = 'data: ';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBe('');
  });

  it('handles multiple event fields (last one wins)', () => {
    const block = 'event: first\nevent: second\ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.event).toBe('second');
  });

  it('handles retry with zero value', () => {
    const block = 'retry: 0\ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.retry).toBe(0);
  });

  it('handles retry with float value (not integer)', () => {
    const block = 'retry: 1.5\ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.retry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WebSocket URL conversion edge cases
// ---------------------------------------------------------------------------

describe('toWebSocketUrl edge cases', () => {
  it('preserves port in conversion', () => {
    const result = toWebSocketUrl(new URL('https://localhost:3000/api'));
    expect(result.port).toBe('3000');
    expect(result.protocol).toBe('wss:');
  });

  it('preserves hash fragment', () => {
    const result = toWebSocketUrl(new URL('https://takos.jp/api#fragment'));
    expect(result.hash).toBe('#fragment');
  });

  it('handles URL with no path', () => {
    const result = toWebSocketUrl(new URL('https://takos.jp'));
    expect(result.protocol).toBe('wss:');
    expect(result.pathname).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// tryParseJson edge cases
// ---------------------------------------------------------------------------

describe('tryParseJson edge cases', () => {
  it('parses boolean true', () => {
    expect(tryParseJson('true')).toBe(true);
  });

  it('parses boolean false', () => {
    expect(tryParseJson('false')).toBe(false);
  });

  it('returns string for partial JSON', () => {
    expect(tryParseJson('{"incomplete')).toBe('{"incomplete');
  });

  it('parses nested object', () => {
    const result = tryParseJson('{"a":{"b":"c"}}');
    expect(result).toEqual({ a: { b: 'c' } });
  });

  it('parses JSON string literal', () => {
    expect(tryParseJson('"hello"')).toBe('hello');
  });
});
