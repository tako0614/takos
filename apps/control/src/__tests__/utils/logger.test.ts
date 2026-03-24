import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  logDebug,
  logInfo,
  logWarn,
  logError,
  createLogger,
  safeJsonParse,
  safeJsonParseOrDefault,
} from '@/utils/logger';

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    expect(safeJsonParse('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns null for null input', () => {
    expect(safeJsonParse(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(safeJsonParse(undefined)).toBeNull();
  });

  it('returns the object directly when input is already an object', () => {
    const obj = { key: 'value' };
    expect(safeJsonParse(obj)).toBe(obj);
  });

  it('returns null for invalid JSON string', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });

  it('returns null for non-string, non-object input (number)', () => {
    expect(safeJsonParse(42)).toBeNull();
  });

  it('returns null for boolean input', () => {
    expect(safeJsonParse(true)).toBeNull();
  });

  it('parses JSON array', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON number string', () => {
    expect(safeJsonParse('42')).toBe(42);
  });

  it('accepts string context parameter', () => {
    // Should still parse; context is for logging
    expect(safeJsonParse('{}', 'test-context')).toEqual({});
  });

  it('accepts object context parameter', () => {
    expect(safeJsonParse('{}', { service: 'test', field: 'data' })).toEqual({});
  });
});

describe('safeJsonParseOrDefault', () => {
  it('returns parsed value when input is valid JSON', () => {
    expect(safeJsonParseOrDefault('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it('returns fallback when input is invalid JSON', () => {
    expect(safeJsonParseOrDefault('not json', 'default')).toBe('default');
  });

  it('returns fallback when input is null', () => {
    expect(safeJsonParseOrDefault(null, 'fallback')).toBe('fallback');
  });

  it('returns fallback when input is undefined', () => {
    expect(safeJsonParseOrDefault(undefined, [])).toEqual([]);
  });

  it('does not return fallback when parsed value is falsy but valid', () => {
    expect(safeJsonParseOrDefault('0', 42)).toBe(0);
    expect(safeJsonParseOrDefault('false', true)).toBe(false);
    expect(safeJsonParseOrDefault('""', 'default')).toBe('');
  });
});

describe('logDebug', () => {
  it('calls console.debug with structured JSON', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logDebug('test message');
    expect(spy).toHaveBeenCalledOnce();
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.level).toBe('debug');
    expect(entry.message).toBe('test message');
    expect(entry.timestamp).toBeTruthy();
    spy.mockRestore();
  });

  it('includes context in log entry', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logDebug('msg', { requestId: '123', action: 'test' });
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.requestId).toBe('123');
    expect(entry.context.action).toBe('test');
    spy.mockRestore();
  });
});

describe('logInfo', () => {
  it('calls console.info with level "info"', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logInfo('info message');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    spy.mockRestore();
  });
});

describe('logWarn', () => {
  it('calls console.warn with level "warn"', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logWarn('warning');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.level).toBe('warn');
    spy.mockRestore();
  });
});

describe('logError', () => {
  it('calls console.error with level "error"', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('error occurred');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('error occurred');
    spy.mockRestore();
  });

  it('includes error details when Error object is passed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('failed', new Error('test error'));
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('test error');
    spy.mockRestore();
  });

  it('handles non-Error error values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('failed', 'string error');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.errorValue).toBe('string error');
    spy.mockRestore();
  });

  it('masks sensitive data in messages (API keys)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('api_key=sk-1234567890abcdef1234567890abcdef');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.message).not.toContain('sk-1234567890abcdef1234567890abcdef');
    expect(entry.message).toContain('[REDACTED');
    spy.mockRestore();
  });

  it('masks Bearer tokens', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.message).not.toContain('eyJhbGciOiJ');
    spy.mockRestore();
  });

  it('masks sensitive keys in context objects', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('test', undefined, { password: 'secret123', userId: 'user-1' } as any);
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.password).toBe('[REDACTED]');
    expect(entry.context.userId).toBe('user-1');
    spy.mockRestore();
  });

  it('masks email addresses in messages', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('User user@example.com failed');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.message).toContain('***@example.com');
    expect(entry.message).not.toContain('user@example.com');
    spy.mockRestore();
  });
});

describe('createLogger', () => {
  it('creates a logger with base context merged into all calls', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger({ module: 'test-module' });
    logger.info('hello');
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.module).toBe('test-module');
    spy.mockRestore();
  });

  it('allows per-call context to override base context', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger({ module: 'base', action: 'default' });
    logger.info('hello', { action: 'override' });
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.context.module).toBe('base');
    expect(entry.context.action).toBe('override');
    spy.mockRestore();
  });

  it('has debug, info, warn, and error methods', () => {
    const logger = createLogger({ module: 'test' });
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('error method includes error details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ module: 'test' });
    logger.error('failed', new Error('boom'));
    const entry = JSON.parse(spy.mock.calls[0][0]);
    expect(entry.error.message).toBe('boom');
    expect(entry.context.module).toBe('test');
    spy.mockRestore();
  });
});
