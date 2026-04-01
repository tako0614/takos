import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals, assertRejects } from 'jsr:@std/assert';

import {
  MEMORY_TOOLS,
  RECALL,
  REMEMBER,
  SET_REMINDER,
  rememberHandler,
  setReminderHandler,
} from '@/tools/builtin/memory';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test('memory tools - definitions are stable', () => {
  assertEquals(REMEMBER.name, 'remember');
  assertEquals(RECALL.name, 'recall');
  assertEquals(SET_REMINDER.name, 'set_reminder');
  assertEquals(MEMORY_TOOLS.map((t) => t.name), ['remember', 'recall', 'set_reminder']);
});

Deno.test('rememberHandler - rejects content exceeding max size', async () => {
  await assertRejects(async () => {
    await rememberHandler(
      { content: 'x'.repeat(100_001), type: 'semantic' },
      makeContext(),
    );
  }, 'Memory content too large');
});

Deno.test('rememberHandler - rejects category exceeding max size', async () => {
  await assertRejects(async () => {
    await rememberHandler(
      { content: 'test', type: 'semantic', category: 'x'.repeat(1001) },
      makeContext(),
    );
  }, 'Memory category too long');
});

Deno.test('setReminderHandler - rejects invalid time formats', async () => {
  await assertRejects(async () => {
    await setReminderHandler(
      { content: 'test', trigger_type: 'time', trigger_value: 'not-a-date' },
      makeContext(),
    );
  }, 'Invalid time format');
});

Deno.test('setReminderHandler - rejects past time values', async () => {
  await assertRejects(async () => {
    await setReminderHandler(
      { content: 'test', trigger_type: 'time', trigger_value: '2000-01-01T00:00:00.000Z' },
      makeContext(),
    );
  }, 'Trigger time must be in the future');
});
