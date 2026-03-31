import {
  buildActionsWatchPath,
  buildRunWatchPath,
  parseSseEventBlock,
  prepareBody,
  resolveTaskPath,
  toWebSocketUrl,
} from '../src/commands/api-request.ts';


import { assertEquals, assertThrows } from 'jsr:@std/assert';

  Deno.test('api command helpers - resolves task target against /api base and normalizes paths', () => {
  assertEquals(resolveTaskPath('/api/workspaces', undefined), '/api/workspaces');
    assertEquals(resolveTaskPath('/api/workspaces', 'abc'), '/api/workspaces/abc');
    assertEquals(resolveTaskPath('/api', 'repos'), '/api/repos');
    assertEquals(resolveTaskPath('/api', '/api/repos'), '/api/repos');

    assertEquals(resolveTaskPath('/api', ''), '/api');
    assertEquals(resolveTaskPath('/api', '/'), '/api');
})
  Deno.test('api command helpers - rejects mixed body modes', () => {
  assertThrows(
    () => prepareBody({ body: '{}', rawBody: 'x' }),
    Error,
    'Only one body mode can be used at a time',
  );

    assertThrows(
      () => prepareBody({ body: '{}', form: ['a=b'] }),
      Error,
      'Only one body mode can be used at a time',
    );
})
  Deno.test('api command helpers - parses SSE event block', () => {
  const parsed = parseSseEventBlock([
      'id: 123',
      'event: run.progress',
      'data: {"step":"compile"}',
      'retry: 1000',
    ].join('\n'));

    assertEquals(parsed, {
      event: 'run.progress',
      id: '123',
      retry: 1000,
      data: '{"step":"compile"}',
    });
})
  Deno.test('api command helpers - converts http/https URLs to ws/wss', () => {
  assertEquals(toWebSocketUrl(new URL('https://takos.jp/api/runs/1/ws')).toString(), 'wss://takos.jp/api/runs/1/ws');
    assertEquals(toWebSocketUrl(new URL('http://localhost:8787/api/runs/1/ws')).toString(), 'ws://localhost:8787/api/runs/1/ws');
})
  Deno.test('api command helpers - builds run and actions stream paths', () => {
  assertEquals(buildRunWatchPath('run-1', 'ws'), '/api/runs/run-1/ws');
    assertEquals(buildRunWatchPath('run-1', 'sse'), '/api/runs/run-1/events');
    assertEquals(buildActionsWatchPath('repo-1', 'run-1'), '/api/repos/repo-1/actions/runs/run-1/ws');
})
