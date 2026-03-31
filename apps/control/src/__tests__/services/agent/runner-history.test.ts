import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  queryRelevantThreadMessages: ((..._args: any[]) => undefined) as any,
  buildThreadContextSystemMessage: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/thread-context'
import { buildConversationHistory } from '@/services/agent/runner';

function makeDbMock(selectGetResults: unknown[], selectAllResults: unknown[]) {
  let getIndex = 0;
  let allIndex = 0;
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.orderBy = (() => c);
    c.limit = (() => c);
    c.all = async () => selectAllResults[allIndex++] ?? [];
    c.get = async () => selectGetResults[getIndex++] ?? null;
    return c;
  };
  return {
    select: () => chain(),
  };
}


  Deno.test('buildConversationHistory - builds delegated child context from the structured delegation packet', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
  mocks.getDb = (() => makeDbMock(
      [
        {
          summary: null,
          keyPoints: '[]',
        },
        {
          parentRunId: 'parent-run',
          input: JSON.stringify({
            delegation: {
              task: 'Implement the fix',
              goal: 'Improve sub-agent autonomy',
              deliverable: 'A passing test suite and code changes',
              constraints: ['Do not change unrelated files'],
              context: ['The parent already isolated the bug'],
              acceptance_criteria: ['All targeted tests pass'],
              product_hint: 'takos',
              locale: 'ja',
              parent_run_id: 'parent-run',
              parent_thread_id: 'thread-1',
              root_thread_id: 'thread-1',
              thread_summary: 'Parent is fixing agent delegation',
              thread_key_points: ['sub-agent should receive explicit context'],
            },
          }),
        },
      ],
      [
        [],
      ],
    )) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'child-thread-1',
      runId: 'child-run',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    assertEquals(history, [
      {
        role: 'system',
        content: expect.stringContaining('Delegated execution context:'),
      },
      {
        role: 'user',
        content: expect.stringContaining('Implement the fix'),
      },
    ]);
    assertStringIncludes(history[0]?.content, 'Product hint: takos');
    assertStringIncludes(history[0]?.content, 'Constraints:');
    assertStringIncludes(history[0]?.content, 'Acceptance criteria:');
})