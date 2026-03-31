import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals, assertRejects, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockGet = ((..._args: any[]) => undefined) as any;
const mockAll = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/services/execution/run-creation'
// [Deno] vi.mock removed - manually stub imports from '@/services/runs/create-thread-run-validation'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/locale'
// [Deno] vi.mock removed - manually stub imports from '@/db'
import { spawnAgentHandler, waitAgentHandler } from '@/tools/builtin/agent';
import { createThreadRun } from '@/services/execution/run-creation';
import { resolveRunModel } from '@/services/runs/create-thread-run-validation';
import { createThread, updateThreadStatus } from '@/services/threads/thread-service';
import { getSpaceLocale } from '@/services/identity/locale';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-1',
    threadId: 'thread-1',
    runId: 'parent-run',
    userId: 'user-1',
    capabilities: ['repo.read'],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}


  Deno.test('agent tools - creates a delegation packet before spawning a delegated run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resolveRunModel = (async () => 'gpt-5.4-mini') as any;
    getSpaceLocale = (async () => 'ja') as any;
    createThread = (async () => ({
      id: 'child-thread-1',
      space_id: 'ws-1',
      title: 'Sub-agent: write tests',
      locale: 'ja',
      status: 'active',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    })) as any;
    createThreadRun = (async () => ({
      ok: true,
      status: 201,
      run: {
        id: 'child-run',
        thread_id: 'child-thread-1',
        space_id: 'ws-1',
        session_id: null,
        parent_run_id: 'parent-run',
        child_thread_id: 'child-thread-1',
        root_thread_id: 'thread-1',
        root_run_id: 'parent-run',
        agent_type: 'default',
        status: 'queued',
        input: '{}',
        output: null,
        error: null,
        usage: '{}',
        worker_id: null,
        worker_heartbeat: null,
        started_at: null,
        completed_at: null,
        created_at: '2026-03-19T00:00:00.000Z',
      },
    })) as any;

    mockGet
       = (async () => ({
        title: 'Fix history UI',
        summary: 'Make sub-agents work better',
        keyPoints: '["prefer structured context"]',
        locale: 'ja',
      })) as any
       = (async () => ({ content: 'Refine the delegation model for Takos' })) as any
       = (async () => ({
        input: JSON.stringify({ task: 'Parent task', goal: 'Ship the delegation improvement' }),
        rootThreadId: 'thread-1',
      })) as any;

    const result = JSON.parse(await spawnAgentHandler({
      task: 'write tests',
      constraints: ['do not touch unrelated files'],
      acceptance_criteria: ['tests pass'],
    }, makeContext()));

    assertSpyCallArgs(createThread, 0, [{}, 'ws-1', {
      title: 'Sub-agent: write tests',
      locale: 'ja',
    }]);
    assertSpyCallArgs(createThreadRun, 0, [expect.anything(), ({
      threadId: 'child-thread-1',
      parentRunId: 'parent-run',
      input: ({
        task: 'write tests',
        locale: 'ja',
        product_hint: 'takos',
        delegation: ({
          task: 'write tests',
          goal: 'Refine the delegation model for Takos',
          product_hint: 'takos',
          locale: 'ja',
          thread_summary: 'Make sub-agents work better',
          thread_key_points: ['prefer structured context'],
          constraints: ['do not touch unrelated files'],
          acceptance_criteria: ['tests pass'],
        }),
        delegation_observability: ({
          explicit_field_count: 3,
          inferred_field_count: 3,
        }),
      }),
    })]);
    assertObjectMatch(result, {
      run_id: 'child-run',
      child_thread_id: 'child-thread-1',
      parent_run_id: 'parent-run',
      delegation: ({
        product_hint: 'takos',
      }),
      delegation_observability: ({
        has_thread_summary: true,
      }),
    });
})
  Deno.test('agent tools - archives the child thread when run creation fails after thread creation', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resolveRunModel = (async () => 'gpt-5.4-mini') as any;
    getSpaceLocale = (async () => 'en') as any;
    createThread = (async () => ({
      id: 'child-thread-1',
      space_id: 'ws-1',
      title: 'Sub-agent: write tests',
      locale: 'en',
      status: 'active',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    })) as any;
    createThreadRun = (async () => ({
      ok: false,
      status: 429,
      error: 'Too many concurrent child runs',
    })) as any;

    mockGet
       = (async () => ({
        title: 'Fix history UI',
        summary: null,
        keyPoints: '[]',
        locale: 'en',
      })) as any
       = (async () => ({ content: 'Write tests' })) as any
       = (async () => ({
        input: JSON.stringify({ task: 'Parent task' }),
        rootThreadId: 'thread-1',
      })) as any;

    await await assertRejects(async () => { await spawnAgentHandler({ task: 'write tests' }, makeContext()); }, 'Cannot spawn sub-agent: Too many concurrent child runs');

    assertSpyCallArgs(updateThreadStatus, 0, [{}, 'child-thread-1', 'archived']);
})
  Deno.test('agent tools - returns the child final response when the run is completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
      id: 'child-run',
      parentRunId: 'parent-run',
      threadId: 'child-thread-1',
      childThreadId: 'child-thread-1',
      rootThreadId: 'thread-1',
      accountId: 'ws-1',
      status: 'completed',
      output: JSON.stringify({ response: 'child done', iterations: 2 }),
      error: null,
      completedAt: '2026-03-19T00:00:00.000Z',
      createdAt: '2026-03-19T00:00:00.000Z',
    })) as any;
    mockAll = (async () => [{
      id: 'artifact-1',
      type: 'report',
      title: 'Child Report',
      created_at: '2026-03-19T00:00:01.000Z',
    }]) as any;

    const result = JSON.parse(await waitAgentHandler({ run_id: 'child-run' }, makeContext()));

    assertEquals(result.status, 'completed');
    assertEquals(result.timed_out, false);
    assertEquals(result.final_response, 'child done');
    assertEquals(result.child_thread_id, 'child-thread-1');
    assertEquals(result.artifacts.length, 1);
})
  Deno.test('agent tools - returns a timeout payload when the child is still running', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
      id: 'child-run',
      parentRunId: 'parent-run',
      threadId: 'child-thread-1',
      childThreadId: 'child-thread-1',
      rootThreadId: 'thread-1',
      accountId: 'ws-1',
      status: 'running',
      output: null,
      error: null,
      completedAt: null,
      createdAt: '2026-03-19T00:00:00.000Z',
    })) as any;
    mockAll = (async () => []) as any;

    const result = JSON.parse(await waitAgentHandler({ run_id: 'child-run', timeout_ms: 1 }, makeContext()));

    assertEquals(result.status, 'running');
    assertEquals(result.timed_out, true);
    assertEquals(result.final_response, null);
})
  Deno.test('agent tools - rejects runs that are not children of the current run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => null) as any;

    await await assertRejects(async () => { await waitAgentHandler({ run_id: 'other-run' }, makeContext()); }, 'Child run not found or not owned by this parent run');
})