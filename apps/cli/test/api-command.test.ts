import { describe, expect, it } from 'vitest';
import {
  buildActionsWatchPath,
  buildRunWatchPath,
  parseSseEventBlock,
  prepareBody,
  resolveTaskPath,
  toWebSocketUrl,
} from '../src/commands/api-request.js';

describe('api command helpers', () => {
  it('resolves task target against /api base and normalizes paths', () => {
    expect(resolveTaskPath('/api/workspaces', undefined)).toBe('/api/workspaces');
    expect(resolveTaskPath('/api/workspaces', 'abc')).toBe('/api/workspaces/abc');
    expect(resolveTaskPath('/api', 'repos')).toBe('/api/repos');
    expect(resolveTaskPath('/api', '/api/repos')).toBe('/api/repos');

    expect(resolveTaskPath('/api', '')).toBe('/api');
    expect(resolveTaskPath('/api', '/')).toBe('/api');
  });

  it('rejects mixed body modes', () => {
    expect(() => prepareBody({ body: '{}', rawBody: 'x' })).toThrow(
      'Only one body mode can be used at a time (json, raw, or form)',
    );

    expect(() => prepareBody({ body: '{}', form: ['a=b'] })).toThrow(
      'Only one body mode can be used at a time (json, raw, or form)',
    );
  });

  it('parses SSE event block', () => {
    const parsed = parseSseEventBlock([
      'id: 123',
      'event: run.progress',
      'data: {"step":"compile"}',
      'retry: 1000',
    ].join('\n'));

    expect(parsed).toEqual({
      event: 'run.progress',
      id: '123',
      retry: 1000,
      data: '{"step":"compile"}',
    });
  });

  it('converts http/https URLs to ws/wss', () => {
    expect(toWebSocketUrl(new URL('https://takos.jp/api/runs/1/ws')).toString())
      .toBe('wss://takos.jp/api/runs/1/ws');
    expect(toWebSocketUrl(new URL('http://localhost:8787/api/runs/1/ws')).toString())
      .toBe('ws://localhost:8787/api/runs/1/ws');
  });

  it('builds run and actions stream paths', () => {
    expect(buildRunWatchPath('run-1', 'ws')).toBe('/api/runs/run-1/ws');
    expect(buildRunWatchPath('run-1', 'sse')).toBe('/api/runs/run-1/events');
    expect(buildActionsWatchPath('repo-1', 'run-1')).toBe('/api/repos/repo-1/actions/runs/run-1/ws');
  });
});
