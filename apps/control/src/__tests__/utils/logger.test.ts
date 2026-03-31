import {
  logDebug,
  logInfo,
  logWarn,
  logError,
  createLogger,
  safeJsonParse,
  safeJsonParseOrDefault,
} from '@/utils/logger';


import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls } from 'jsr:@std/testing/mock';

  Deno.test('safeJsonParse - parses valid JSON string', () => {
  assertEquals(safeJsonParse('{"key":"value"}'), { key: 'value' });
})
  Deno.test('safeJsonParse - returns null for null input', () => {
  assertEquals(safeJsonParse(null), null);
})
  Deno.test('safeJsonParse - returns null for undefined input', () => {
  assertEquals(safeJsonParse(undefined), null);
})
  Deno.test('safeJsonParse - returns the object directly when input is already an object', () => {
  const obj = { key: 'value' };
    assertEquals(safeJsonParse(obj), obj);
})
  Deno.test('safeJsonParse - returns null for invalid JSON string', () => {
  assertEquals(safeJsonParse('not json'), null);
})
  Deno.test('safeJsonParse - returns null for non-string, non-object input (number)', () => {
  assertEquals(safeJsonParse(42), null);
})
  Deno.test('safeJsonParse - returns null for boolean input', () => {
  assertEquals(safeJsonParse(true), null);
})
  Deno.test('safeJsonParse - parses JSON array', () => {
  assertEquals(safeJsonParse('[1,2,3]'), [1, 2, 3]);
})
  Deno.test('safeJsonParse - parses JSON number string', () => {
  assertEquals(safeJsonParse('42'), 42);
})
  Deno.test('safeJsonParse - accepts string context parameter', () => {
  // Should still parse; context is for logging
    assertEquals(safeJsonParse('{}', 'test-context'), {});
})
  Deno.test('safeJsonParse - accepts object context parameter', () => {
  assertEquals(safeJsonParse('{}', { service: 'test', field: 'data' }), {});
})

  Deno.test('safeJsonParseOrDefault - returns parsed value when input is valid JSON', () => {
  assertEquals(safeJsonParseOrDefault('{"a":1}', { a: 0 }), { a: 1 });
})
  Deno.test('safeJsonParseOrDefault - returns fallback when input is invalid JSON', () => {
  assertEquals(safeJsonParseOrDefault('not json', 'default'), 'default');
})
  Deno.test('safeJsonParseOrDefault - returns fallback when input is null', () => {
  assertEquals(safeJsonParseOrDefault(null, 'fallback'), 'fallback');
})
  Deno.test('safeJsonParseOrDefault - returns fallback when input is undefined', () => {
  assertEquals(safeJsonParseOrDefault(undefined, []), []);
})
  Deno.test('safeJsonParseOrDefault - does not return fallback when parsed value is falsy but valid', () => {
  assertEquals(safeJsonParseOrDefault('0', 42), 0);
    assertEquals(safeJsonParseOrDefault('false', true), false);
    assertEquals(safeJsonParseOrDefault('""', 'default'), '');
})

  Deno.test('logDebug - calls console.debug with structured JSON', () => {
  const spy = stub(console, 'debug') = () => {} as any;
    logDebug('test message');
    assertSpyCalls(spy, 1);
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.level, 'debug');
    assertEquals(entry.message, 'test message');
    assert(entry.timestamp);
    spy.restore();
})
  Deno.test('logDebug - includes context in log entry', () => {
  const spy = stub(console, 'debug') = () => {} as any;
    logDebug('msg', { requestId: '123', action: 'test' });
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.context.requestId, '123');
    assertEquals(entry.context.action, 'test');
    spy.restore();
})

  Deno.test('logInfo - calls console.info with level "info"', () => {
  const spy = stub(console, 'info') = () => {} as any;
    logInfo('info message');
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.level, 'info');
    spy.restore();
})

  Deno.test('logWarn - calls console.warn with level "warn"', () => {
  const spy = stub(console, 'warn') = () => {} as any;
    logWarn('warning');
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.level, 'warn');
    spy.restore();
})

  Deno.test('logError - calls console.error with level "error"', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('error occurred');
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.level, 'error');
    assertEquals(entry.message, 'error occurred');
    spy.restore();
})
  Deno.test('logError - includes error details when Error object is passed', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('failed', new Error('test error'));
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.error.name, 'Error');
    assertEquals(entry.error.message, 'test error');
    spy.restore();
})
  Deno.test('logError - handles non-Error error values', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('failed', 'string error');
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.context.errorValue, 'string error');
    spy.restore();
})
  Deno.test('logError - masks sensitive data in messages (API keys)', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('api_key=sk-1234567890abcdef1234567890abcdef');
    const entry = JSON.parse(spy.calls[0][0]);
    assert(!(entry.message).includes('sk-1234567890abcdef1234567890abcdef'));
    assertStringIncludes(entry.message, '[REDACTED');
    spy.restore();
})
  Deno.test('logError - masks Bearer tokens', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    const entry = JSON.parse(spy.calls[0][0]);
    assert(!(entry.message).includes('eyJhbGciOiJ'));
    spy.restore();
})
  Deno.test('logError - masks sensitive keys in context objects', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('test', undefined, { password: 'secret123', userId: 'user-1' } as any);
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.context.password, '[REDACTED]');
    assertEquals(entry.context.userId, 'user-1');
    spy.restore();
})
  Deno.test('logError - masks email addresses in messages', () => {
  const spy = stub(console, 'error') = () => {} as any;
    logError('User user@example.com failed');
    const entry = JSON.parse(spy.calls[0][0]);
    assertStringIncludes(entry.message, '***@example.com');
    assert(!(entry.message).includes('user@example.com'));
    spy.restore();
})

  Deno.test('createLogger - creates a logger with base context merged into all calls', () => {
  const spy = stub(console, 'info') = () => {} as any;
    const logger = createLogger({ module: 'test-module' });
    logger.info('hello');
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.context.module, 'test-module');
    spy.restore();
})
  Deno.test('createLogger - allows per-call context to override base context', () => {
  const spy = stub(console, 'info') = () => {} as any;
    const logger = createLogger({ module: 'base', action: 'default' });
    logger.info('hello', { action: 'override' });
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.context.module, 'base');
    assertEquals(entry.context.action, 'override');
    spy.restore();
})
  Deno.test('createLogger - has debug, info, warn, and error methods', () => {
  const logger = createLogger({ module: 'test' });
    assertEquals(typeof logger.debug, 'function');
    assertEquals(typeof logger.info, 'function');
    assertEquals(typeof logger.warn, 'function');
    assertEquals(typeof logger.error, 'function');
})
  Deno.test('createLogger - error method includes error details', () => {
  const spy = stub(console, 'error') = () => {} as any;
    const logger = createLogger({ module: 'test' });
    logger.error('failed', new Error('boom'));
    const entry = JSON.parse(spy.calls[0][0]);
    assertEquals(entry.error.message, 'boom');
    assertEquals(entry.context.module, 'test');
    spy.restore();
})