import { describe, expect, it, vi } from 'vitest';
import {
  parseKeyValue,
  prepareBody,
  resolveTaskPath,
  toWebSocketUrl,
  buildRunWatchPath,
  buildActionsWatchPath,
  parseSseEventBlock,
  tryParseJson,
} from '../src/commands/api-request.js';

// ---------------------------------------------------------------------------
// parseKeyValue
// ---------------------------------------------------------------------------

describe('parseKeyValue', () => {
  it('parses simple key=value', () => {
    expect(parseKeyValue('foo=bar')).toEqual({ key: 'foo', value: 'bar' });
  });

  it('handles value containing equals sign', () => {
    expect(parseKeyValue('key=a=b=c')).toEqual({ key: 'key', value: 'a=b=c' });
  });

  it('trims key whitespace', () => {
    expect(parseKeyValue('  key  =value')).toEqual({ key: 'key', value: 'value' });
  });

  it('preserves value whitespace', () => {
    expect(parseKeyValue('key=  value  ')).toEqual({ key: 'key', value: '  value  ' });
  });

  it('throws on missing separator', () => {
    expect(() => parseKeyValue('noequals')).toThrow('Invalid key=value option');
  });

  it('throws on leading separator (empty key)', () => {
    expect(() => parseKeyValue('=value')).toThrow('Invalid key=value option');
  });

  it('handles empty value', () => {
    expect(parseKeyValue('key=')).toEqual({ key: 'key', value: '' });
  });
});

// ---------------------------------------------------------------------------
// prepareBody
// ---------------------------------------------------------------------------

describe('prepareBody', () => {
  it('returns undefined body when no options are provided', () => {
    const result = prepareBody({});
    expect(result).toEqual({ body: undefined, contentType: null });
  });

  it('parses valid JSON body', () => {
    const result = prepareBody({ body: '{"key":"value"}' });
    expect(result.contentType).toBe('application/json');
    expect(result.body).toBe('{"key":"value"}');
  });

  it('throws on invalid JSON body', () => {
    expect(() => prepareBody({ body: '{invalid' })).toThrow('Invalid JSON body');
  });

  it('prepares raw body with default text content type', () => {
    const result = prepareBody({ rawBody: 'hello world' });
    expect(result.body).toBe('hello world');
    expect(result.contentType).toBe('text/plain; charset=utf-8');
  });

  it('prepares raw body with custom content type', () => {
    const result = prepareBody({ rawBody: '<xml/>', contentType: 'application/xml' });
    expect(result.body).toBe('<xml/>');
    expect(result.contentType).toBe('application/xml');
  });

  it('prepares form body', () => {
    const result = prepareBody({ form: ['key=value'] });
    expect(result.body).toBeInstanceOf(FormData);
    expect(result.contentType).toBeNull();
  });

  it('throws when combining JSON and raw', () => {
    expect(() => prepareBody({ body: '{}', rawBody: 'raw' })).toThrow(
      'Only one body mode can be used at a time',
    );
  });

  it('throws when combining JSON and form', () => {
    expect(() => prepareBody({ body: '{}', form: ['a=b'] })).toThrow(
      'Only one body mode can be used at a time',
    );
  });

  it('throws when combining raw and form', () => {
    expect(() => prepareBody({ rawBody: 'raw', form: ['a=b'] })).toThrow(
      'Only one body mode can be used at a time',
    );
  });

  it('does not count empty arrays as form mode', () => {
    const result = prepareBody({ form: [], formFile: [] });
    expect(result).toEqual({ body: undefined, contentType: null });
  });
});

// ---------------------------------------------------------------------------
// resolveTaskPath
// ---------------------------------------------------------------------------

describe('resolveTaskPath', () => {
  it('returns basePath when suffix is undefined', () => {
    expect(resolveTaskPath('/api/workspaces', undefined)).toBe('/api/workspaces');
  });

  it('returns basePath when suffix is empty', () => {
    expect(resolveTaskPath('/api/workspaces', '')).toBe('/api/workspaces');
  });

  it('returns basePath when suffix is only whitespace', () => {
    expect(resolveTaskPath('/api/workspaces', '   ')).toBe('/api/workspaces');
  });

  it('returns basePath when suffix is only /', () => {
    expect(resolveTaskPath('/api', '/')).toBe('/api');
  });

  it('appends suffix to basePath', () => {
    expect(resolveTaskPath('/api/workspaces', 'abc')).toBe('/api/workspaces/abc');
  });

  it('appends suffix with leading slash', () => {
    expect(resolveTaskPath('/api/workspaces', '/abc')).toBe('/api/workspaces/abc');
  });

  it('for /api base, adds relative suffix under /api', () => {
    expect(resolveTaskPath('/api', 'repos')).toBe('/api/repos');
  });

  it('for /api base, handles full /api path suffix', () => {
    expect(resolveTaskPath('/api', '/api/repos')).toBe('/api/repos');
  });

  it('throws when path does not start with /api', () => {
    expect(() => resolveTaskPath('/other', undefined)).toThrow('Path must start with /api');
  });

  it('throws for empty path', () => {
    expect(() => resolveTaskPath('', undefined)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// toWebSocketUrl
// ---------------------------------------------------------------------------

describe('toWebSocketUrl', () => {
  it('converts https to wss', () => {
    const result = toWebSocketUrl(new URL('https://takos.jp/api/ws'));
    expect(result.protocol).toBe('wss:');
    expect(result.href).toBe('wss://takos.jp/api/ws');
  });

  it('converts http to ws', () => {
    const result = toWebSocketUrl(new URL('http://localhost:8787/api/ws'));
    expect(result.protocol).toBe('ws:');
  });

  it('throws on unsupported protocol', () => {
    expect(() => toWebSocketUrl(new URL('ftp://example.com/path'))).toThrow(
      'Unsupported protocol for WebSocket conversion',
    );
  });

  it('preserves path and query params', () => {
    const result = toWebSocketUrl(new URL('https://takos.jp/api/runs/1/ws?token=abc'));
    expect(result.pathname).toBe('/api/runs/1/ws');
    expect(result.searchParams.get('token')).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// buildRunWatchPath / buildActionsWatchPath
// ---------------------------------------------------------------------------

describe('buildRunWatchPath', () => {
  it('builds SSE path', () => {
    expect(buildRunWatchPath('run-123', 'sse')).toBe('/api/runs/run-123/events');
  });

  it('builds WebSocket path', () => {
    expect(buildRunWatchPath('run-123', 'ws')).toBe('/api/runs/run-123/ws');
  });

  it('URL-encodes the run ID', () => {
    expect(buildRunWatchPath('run/special', 'sse')).toBe('/api/runs/run%2Fspecial/events');
  });
});

describe('buildActionsWatchPath', () => {
  it('builds correct path', () => {
    expect(buildActionsWatchPath('repo-1', 'run-1')).toBe(
      '/api/repos/repo-1/actions/runs/run-1/ws',
    );
  });

  it('URL-encodes repo and run IDs', () => {
    expect(buildActionsWatchPath('my/repo', 'my/run')).toBe(
      '/api/repos/my%2Frepo/actions/runs/my%2Frun/ws',
    );
  });
});

// ---------------------------------------------------------------------------
// parseSseEventBlock
// ---------------------------------------------------------------------------

describe('parseSseEventBlock', () => {
  it('returns null for empty block', () => {
    expect(parseSseEventBlock('')).toBeNull();
    expect(parseSseEventBlock('  \n  ')).toBeNull();
  });

  it('parses basic data-only event', () => {
    const result = parseSseEventBlock('data: hello');
    expect(result).toEqual({
      event: 'message',
      data: 'hello',
    });
  });

  it('parses event with all fields', () => {
    const block = 'id: 42\nevent: update\ndata: {"key":"val"}\nretry: 3000';
    const result = parseSseEventBlock(block);
    expect(result).toEqual({
      event: 'update',
      id: '42',
      retry: 3000,
      data: '{"key":"val"}',
    });
  });

  it('joins multiple data lines with newline', () => {
    const block = 'data: line1\ndata: line2\ndata: line3';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBe('line1\nline2\nline3');
  });

  it('defaults event to "message" when event line has empty value', () => {
    const block = 'event: \ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.event).toBe('message');
  });

  it('ignores comment lines starting with :', () => {
    const block = ': this is a comment\ndata: actual data';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBe('actual data');
  });

  it('ignores lines without colon separator', () => {
    const block = 'noseparator\ndata: valid';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBe('valid');
  });

  it('ignores invalid retry values', () => {
    const block = 'retry: abc\ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.retry).toBeUndefined();
  });

  it('ignores negative retry values', () => {
    const block = 'retry: -100\ndata: test';
    const result = parseSseEventBlock(block);
    expect(result?.retry).toBeUndefined();
  });

  it('returns null data when no data lines present', () => {
    const block = 'event: ping';
    const result = parseSseEventBlock(block);
    expect(result?.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tryParseJson
// ---------------------------------------------------------------------------

describe('tryParseJson', () => {
  it('parses valid JSON', () => {
    expect(tryParseJson('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('parses JSON array', () => {
    expect(tryParseJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns original string for invalid JSON', () => {
    expect(tryParseJson('not json')).toBe('not json');
  });

  it('parses JSON null', () => {
    expect(tryParseJson('null')).toBeNull();
  });

  it('parses JSON number', () => {
    expect(tryParseJson('42')).toBe(42);
  });

  it('returns empty string as-is (invalid JSON)', () => {
    expect(tryParseJson('')).toBe('');
  });
});
