import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  MAX_LOG_LINES: 5,
}));

import { pushLog } from '../../runtime/logging.js';

describe('pushLog', () => {
  it('pushes a message to the log array', () => {
    const logs: string[] = [];
    pushLog(logs, 'hello');
    expect(logs).toEqual(['hello']);
  });

  it('pushes multiple messages', () => {
    const logs: string[] = [];
    pushLog(logs, 'first');
    pushLog(logs, 'second');
    expect(logs).toEqual(['first', 'second']);
  });

  it('truncates individual lines exceeding 10000 chars', () => {
    const logs: string[] = [];
    const longLine = 'x'.repeat(15000);
    pushLog(logs, longLine);
    expect(logs[0]).toHaveLength(10000 + '...[truncated]'.length);
    expect(logs[0].endsWith('...[truncated]')).toBe(true);
  });

  it('stops appending after MAX_LOG_LINES and adds truncation notice', () => {
    const logs: string[] = [];
    // MAX_LOG_LINES is mocked to 5
    for (let i = 0; i < 10; i++) {
      pushLog(logs, `line ${i}`);
    }
    // Should have 5 normal lines + 1 truncation notice = 6 total
    expect(logs).toHaveLength(6);
    expect(logs[5]).toBe('...log truncated');
  });

  it('adds truncation notice only once', () => {
    const logs: string[] = [];
    for (let i = 0; i < 20; i++) {
      pushLog(logs, `line ${i}`);
    }
    const truncationCount = logs.filter(l => l === '...log truncated').length;
    expect(truncationCount).toBe(1);
  });

  it('sanitizes message with provided sanitizer', () => {
    const logs: string[] = [];
    const sanitizer = {
      sanitize: (text: string) => text.replace(/secret/g, '***'),
    };
    pushLog(logs, 'my secret value', sanitizer as any);
    expect(logs[0]).toBe('my *** value');
  });

  it('works without sanitizer', () => {
    const logs: string[] = [];
    pushLog(logs, 'no sanitizer', undefined);
    expect(logs[0]).toBe('no sanitizer');
  });
});
