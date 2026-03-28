import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

const mockGet = vi.fn();
const mockAll = vi.fn();

vi.mock('@/services/execution/run-creation', () => ({
  createThreadRun: vi.fn(),
}));

vi.mock('@/services/runs/create-thread-run-validation', () => ({
  resolveRunModel: vi.fn(),
}));

vi.mock('@/services/threads/thread-service', () => ({
  createThread: vi.fn(),
  updateThreadStatus: vi.fn(),
}));

vi.mock('@/services/identity/locale', () => ({
  getSpaceLocale: vi.fn(),
}));

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(() => mockGet()),
    all: vi.fn(() => mockAll()),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
    }),
    runs: {
      id: 'id',
      input: 'input',
      rootThreadId: 'root_thread_id',
      parentRunId: 'parent_run_id',
      threadId: 'thread_id',
      childThreadId: 'child_thread_id',
      accountId: 'account_id',
      status: 'status',
      output: 'output',
      error: 'error',
      completedAt: 'completed_at',
      createdAt: 'created_at',
    },
    threads: {
      id: 'id',
      title: 'title',
      summary: 'summary',
      keyPoints: 'key_points',
      locale: 'locale',
    },
    messages: {
      threadId: 'thread_id',
      role: 'role',
      content: 'content',
      sequence: 'sequence',
    },
    artifacts: {
      id: 'id',
      runId: 'run_id',
      type: 'type',
      title: 'title',
      createdAt: 'created_at',
    },
  };
});

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
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

describe('agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a delegation packet before spawning a delegated run', async () => {
    vi.mocked(resolveRunModel).mockResolvedValue('gpt-5.4-mini');
    vi.mocked(getSpaceLocale).mockResolvedValue('ja');
    vi.mocked(createThread).mockResolvedValue({
      id: 'child-thread-1',
      space_id: 'ws-1',
      title: 'Sub-agent: write tests',
      locale: 'ja',
      status: 'active',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    vi.mocked(createThreadRun).mockResolvedValue({
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
    });

    mockGet
      .mockResolvedValueOnce({
        title: 'Fix history UI',
        summary: 'Make sub-agents work better',
        keyPoints: '["prefer structured context"]',
        locale: 'ja',
      })
      .mockResolvedValueOnce({ content: 'Refine the delegation model for Takos' })
      .mockResolvedValueOnce({
        input: JSON.stringify({ task: 'Parent task', goal: 'Ship the delegation improvement' }),
        rootThreadId: 'thread-1',
      });

    const result = JSON.parse(await spawnAgentHandler({
      task: 'write tests',
      constraints: ['do not touch unrelated files'],
      acceptance_criteria: ['tests pass'],
    }, makeContext()));

    expect(createThread).toHaveBeenCalledWith({}, 'ws-1', {
      title: 'Sub-agent: write tests',
      locale: 'ja',
    });
    expect(createThreadRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      threadId: 'child-thread-1',
      parentRunId: 'parent-run',
      input: expect.objectContaining({
        task: 'write tests',
        locale: 'ja',
        product_hint: 'takos',
        delegation: expect.objectContaining({
          task: 'write tests',
          goal: 'Refine the delegation model for Takos',
          product_hint: 'takos',
          locale: 'ja',
          thread_summary: 'Make sub-agents work better',
          thread_key_points: ['prefer structured context'],
          constraints: ['do not touch unrelated files'],
          acceptance_criteria: ['tests pass'],
        }),
        delegation_observability: expect.objectContaining({
          explicit_field_count: 3,
          inferred_field_count: 3,
        }),
      }),
    }));
    expect(result).toMatchObject({
      run_id: 'child-run',
      child_thread_id: 'child-thread-1',
      parent_run_id: 'parent-run',
      delegation: expect.objectContaining({
        product_hint: 'takos',
      }),
      delegation_observability: expect.objectContaining({
        has_thread_summary: true,
      }),
    });
  });

  it('archives the child thread when run creation fails after thread creation', async () => {
    vi.mocked(resolveRunModel).mockResolvedValue('gpt-5.4-mini');
    vi.mocked(getSpaceLocale).mockResolvedValue('en');
    vi.mocked(createThread).mockResolvedValue({
      id: 'child-thread-1',
      space_id: 'ws-1',
      title: 'Sub-agent: write tests',
      locale: 'en',
      status: 'active',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    vi.mocked(createThreadRun).mockResolvedValue({
      ok: false,
      status: 429,
      error: 'Too many concurrent child runs',
    });

    mockGet
      .mockResolvedValueOnce({
        title: 'Fix history UI',
        summary: null,
        keyPoints: '[]',
        locale: 'en',
      })
      .mockResolvedValueOnce({ content: 'Write tests' })
      .mockResolvedValueOnce({
        input: JSON.stringify({ task: 'Parent task' }),
        rootThreadId: 'thread-1',
      });

    await expect(spawnAgentHandler({ task: 'write tests' }, makeContext()))
      .rejects
      .toThrow('Cannot spawn sub-agent: Too many concurrent child runs');

    expect(updateThreadStatus).toHaveBeenCalledWith({}, 'child-thread-1', 'archived');
  });

  it('returns the child final response when the run is completed', async () => {
    mockGet.mockResolvedValueOnce({
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
    });
    mockAll.mockResolvedValueOnce([{
      id: 'artifact-1',
      type: 'report',
      title: 'Child Report',
      created_at: '2026-03-19T00:00:01.000Z',
    }]);

    const result = JSON.parse(await waitAgentHandler({ run_id: 'child-run' }, makeContext()));

    expect(result.status).toBe('completed');
    expect(result.timed_out).toBe(false);
    expect(result.final_response).toBe('child done');
    expect(result.child_thread_id).toBe('child-thread-1');
    expect(result.artifacts).toHaveLength(1);
  });

  it('returns a timeout payload when the child is still running', async () => {
    mockGet.mockResolvedValue({
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
    });
    mockAll.mockResolvedValue([]);

    const result = JSON.parse(await waitAgentHandler({ run_id: 'child-run', timeout_ms: 1 }, makeContext()));

    expect(result.status).toBe('running');
    expect(result.timed_out).toBe(true);
    expect(result.final_response).toBeNull();
  });

  it('rejects runs that are not children of the current run', async () => {
    mockGet.mockResolvedValueOnce(null);

    await expect(waitAgentHandler({ run_id: 'other-run' }, makeContext()))
      .rejects
      .toThrow('Child run not found or not owned by this parent run');
  });
});
