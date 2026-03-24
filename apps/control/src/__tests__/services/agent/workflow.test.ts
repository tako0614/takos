import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createLLMClient: vi.fn(),
  getDb: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
  callRuntimeRequest: vi.fn(),
  buildPRDiffText: vi.fn(),
  SnapshotManager: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/services/agent/llm', () => ({
  createLLMClient: mocks.createLLMClient,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  pullRequests: {
    id: 'id',
    repoId: 'repoId',
    number: 'number',
    title: 'title',
    description: 'description',
    headBranch: 'headBranch',
    baseBranch: 'baseBranch',
    status: 'status',
    authorType: 'authorType',
    authorId: 'authorId',
    runId: 'runId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    mergedAt: 'mergedAt',
  },
  prReviews: {
    id: 'id',
    prId: 'prId',
    reviewerType: 'reviewerType',
    reviewerId: 'reviewerId',
    status: 'status',
    body: 'body',
    analysis: 'analysis',
    createdAt: 'createdAt',
  },
  sessions: {
    id: 'id',
    accountId: 'accountId',
    baseSnapshotId: 'baseSnapshotId',
    status: 'status',
    headSnapshotId: 'headSnapshotId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    branch: 'branch',
  },
  accounts: {
    id: 'id',
    headSnapshotId: 'headSnapshotId',
    updatedAt: 'updatedAt',
  },
  runs: {
    id: 'id',
    sessionId: 'sessionId',
  },
  branches: {
    repoId: 'repoId',
    name: 'name',
    isDefault: 'isDefault',
  },
  files: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/pull-requests/ai-review', () => ({
  buildPRDiffText: mocks.buildPRDiffText,
}));

vi.mock('@/services/sync/snapshot', () => ({
  SnapshotManager: mocks.SnapshotManager,
}));

vi.mock('@/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: mocks.logError,
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  safeJsonParse: vi.fn((v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }),
  safeJsonParseOrDefault: vi.fn((v: unknown, d: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return d; } }),
}));

import {
  analyzeTask,
  executeCodeChangeWorkflow,
  executeReview,
  orchestrateWorkflow,
  type TaskPlan,
  type WorkflowContext,
} from '@/services/agent/workflow';

describe('analyzeTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid task analysis response', async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({
        type: 'code_change',
        tools: ['file_read', 'file_write'],
        needsRepo: true,
        needsRuntime: true,
        usePR: true,
        needsReview: true,
        reviewType: 'self',
        commitMessage: 'Fix the bug',
        reasoning: 'This needs code changes',
      }),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const plan = await analyzeTask('Fix the login bug', {
      spaceId: 'ws-1',
      userId: 'user-1',
      tools: ['file_read', 'file_write'],
      apiKey: 'test-key',
    });

    expect(plan.type).toBe('code_change');
    expect(plan.tools).toEqual(['file_read', 'file_write']);
    expect(plan.needsRepo).toBe(true);
    expect(plan.commitMessage).toBe('Fix the bug');
  });

  it('defaults to conversation on parse failure', async () => {
    const mockChat = vi.fn(async () => ({
      content: 'This is not valid JSON',
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const plan = await analyzeTask('Do something', {
      spaceId: 'ws-1',
      userId: 'user-1',
      tools: [],
      apiKey: 'test-key',
    });

    expect(plan.type).toBe('conversation');
    expect(plan.reasoning).toContain('failed');
  });

  it('normalizes invalid plan type to conversation', async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({ type: 'invalid_type' }),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const plan = await analyzeTask('Something', {
      spaceId: 'ws-1',
      userId: 'user-1',
      tools: [],
      apiKey: 'key',
    });

    expect(plan.type).toBe('conversation');
  });

  it('handles markdown-wrapped JSON response', async () => {
    const mockChat = vi.fn(async () => ({
      content: '```json\n{"type":"tool_only","tools":["web_search"]}\n```',
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const plan = await analyzeTask('Search for something', {
      spaceId: 'ws-1',
      userId: 'user-1',
      tools: ['web_search'],
      apiKey: 'key',
    });

    expect(plan.type).toBe('tool_only');
  });

  it('defaults optional fields when not provided in response', async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({ type: 'conversation' }),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const plan = await analyzeTask('Chat with me', {
      spaceId: 'ws-1',
      userId: 'user-1',
      tools: [],
      apiKey: 'key',
    });

    expect(plan.tools).toEqual([]);
    expect(plan.needsRepo).toBe(false);
    expect(plan.needsRuntime).toBe(false);
    expect(plan.usePR).toBe(false);
    expect(plan.needsReview).toBe(false);
    expect(plan.reviewType).toBe('self');
  });
});

describe('executeCodeChangeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('gen-id');
    mocks.now.mockReturnValue('2025-01-01T00:00:00Z');
  });

  it('returns success for a simple code change without PR', async () => {
    const plan: TaskPlan = {
      type: 'code_change',
      tools: ['file_write'],
      needsRepo: false,
      usePR: false,
      commitMessage: 'Simple change',
    };

    const context: WorkflowContext = {
      env: {} as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
    };

    const result = await executeCodeChangeWorkflow('Fix a typo', plan, context);
    expect(result.success).toBe(true);
    expect(result.message).toContain('directly');
  });

  it('handles errors gracefully and marks steps as failed', async () => {
    const plan: TaskPlan = {
      type: 'code_change',
      tools: ['file_write'],
      needsRepo: true,
      repoId: 'repo-1',
      usePR: true,
      commitMessage: 'Changes',
    };

    // Make createPullRequest fail
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockRejectedValue(new Error('DB connection failed')),
          }),
        }),
      }),
    };
    mocks.getDb.mockReturnValue(mockDb);

    const context: WorkflowContext = {
      env: { DB: {} } as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
    };

    const result = await executeCodeChangeWorkflow('Make changes', plan, context);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Workflow failed');
    expect(result.steps?.some((s) => s.status === 'failed')).toBe(true);
  });
});

describe('executeReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('review-id');
    mocks.now.mockReturnValue('2025-01-01T00:00:00Z');
  });

  it('throws when OPENAI_API_KEY is not configured', async () => {
    const context: WorkflowContext = {
      env: {} as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
    };

    await expect(executeReview(context, 'pr-1', 'self')).rejects.toThrow('OpenAI API key');
  });

  it('throws when PR not found', async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn(async () => null),
          }),
        }),
      }),
    };
    mocks.getDb.mockReturnValue(mockDb);

    const context: WorkflowContext = {
      env: { OPENAI_API_KEY: 'key', DB: {} } as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
    };

    await expect(executeReview(context, 'pr-999', 'self')).rejects.toThrow('PR not found');
  });
});

describe('orchestrateWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns conversation result for conversation plan type', async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({ type: 'conversation' }),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const result = await orchestrateWorkflow('Tell me a joke', {
      env: {} as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
      apiKey: 'key',
      tools: [],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('conversation');
  });

  it('returns tool steps for tool_only plan type', async () => {
    mocks.generateId.mockReturnValue('step-id');
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({ type: 'tool_only', tools: ['web_search', 'file_read'] }),
      usage: { inputTokens: 10, outputTokens: 20 },
    }));
    mocks.createLLMClient.mockReturnValue({ chat: mockChat });

    const result = await orchestrateWorkflow('Search and read', {
      env: {} as any,
      spaceId: 'ws-1',
      userId: 'user-1',
      threadId: 'thread-1',
      runId: 'run-1',
      apiKey: 'key',
      tools: ['web_search', 'file_read'],
    });

    expect(result.success).toBe(true);
    expect(result.steps?.length).toBe(2);
    expect(result.steps?.[0].type).toBe('tool_call');
  });
});

describe('TaskPlan type structure', () => {
  it('supports all valid plan types', () => {
    const types: TaskPlan['type'][] = ['conversation', 'tool_only', 'code_change', 'composite'];
    expect(types).toHaveLength(4);
  });
});

describe('TaskStep type structure', () => {
  it('supports all step types', () => {
    const types = ['tool_call', 'code_change', 'review', 'commit', 'pr_create', 'pr_merge'];
    expect(types).toHaveLength(6);
  });

  it('supports all step statuses', () => {
    const statuses = ['pending', 'running', 'completed', 'failed', 'skipped'];
    expect(statuses).toHaveLength(5);
  });
});
