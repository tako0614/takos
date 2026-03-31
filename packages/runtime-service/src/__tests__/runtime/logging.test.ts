// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
import { pushLog } from '../../runtime/logging.ts';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('pushLog - pushes a message to the log array', () => {
  const logs: string[] = [];
    pushLog(logs, 'hello');
    assertEquals(logs, ['hello']);
})
  Deno.test('pushLog - pushes multiple messages', () => {
  const logs: string[] = [];
    pushLog(logs, 'first');
    pushLog(logs, 'second');
    assertEquals(logs, ['first', 'second']);
})
  Deno.test('pushLog - truncates individual lines exceeding 10000 chars', () => {
  const logs: string[] = [];
    const longLine = 'x'.repeat(15000);
    pushLog(logs, longLine);
    assertEquals(logs[0].length, 10000 + '...[truncated]'.length);
    assertEquals(logs[0].endsWith('...[truncated]'), true);
})
  Deno.test('pushLog - stops appending after MAX_LOG_LINES and adds truncation notice', () => {
  const logs: string[] = [];
    // MAX_LOG_LINES is mocked to 5
    for (let i = 0; i < 10; i++) {
      pushLog(logs, `line ${i}`);
    }
    // Should have 5 normal lines + 1 truncation notice = 6 total
    assertEquals(logs.length, 6);
    assertEquals(logs[5], '...log truncated');
})
  Deno.test('pushLog - adds truncation notice only once', () => {
  const logs: string[] = [];
    for (let i = 0; i < 20; i++) {
      pushLog(logs, `line ${i}`);
    }
    const truncationCount = logs.filter(l => l === '...log truncated').length;
    assertEquals(truncationCount, 1);
})
  Deno.test('pushLog - sanitizes message with provided sanitizer', () => {
  const logs: string[] = [];
    const sanitizer = {
      sanitize: (text: string) => text.replace(/secret/g, '***'),
    };
    pushLog(logs, 'my secret value', sanitizer as any);
    assertEquals(logs[0], 'my *** value');
})
  Deno.test('pushLog - works without sanitizer', () => {
  const logs: string[] = [];
    pushLog(logs, 'no sanitizer', undefined);
    assertEquals(logs[0], 'no sanitizer');
})