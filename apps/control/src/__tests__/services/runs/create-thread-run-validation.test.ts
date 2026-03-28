import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getRunHierarchyNode: vi.fn(),
  getWorkspaceModel: vi.fn(),
  isValidOpaqueId: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/services/runs/create-thread-run-store', () => ({
  getRunHierarchyNode: mocks.getRunHierarchyNode,
  getWorkspaceModel: mocks.getWorkspaceModel,
}));

vi.mock('@/shared/utils/db-guards', () => ({
  isValidOpaqueId: mocks.isValidOpaqueId,
}));

vi.mock('@/shared/utils/logger', () => ({
  logWarn: mocks.logWarn,
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

// We need to mock agent module for DEFAULT_MODEL_ID and normalizeModelId
vi.mock('@/services/agent', () => ({
  DEFAULT_MODEL_ID: 'gpt-5.4-nano',
  normalizeModelId: (model?: string | null) => {
    if (!model) return null;
    const supported = ['gpt-5.4-nano', 'gpt-5.4-mini'];
    const normalized = model.toLowerCase().trim();
    return supported.includes(normalized) ? normalized : null;
  },
}));

import { validateParentRunId, resolveRunModel } from '@/services/runs/create-thread-run-validation';

function makeNode(overrides: Partial<{
  id: string;
  threadId: string;
  accountId: string;
  parentRunId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'run-1',
    threadId: overrides.threadId ?? 'thread-1',
    accountId: overrides.accountId ?? 'space-1',
    parentRunId: overrides.parentRunId ?? null,
    rootThreadId: overrides.rootThreadId ?? null,
    rootRunId: overrides.rootRunId ?? null,
  };
}

describe('validateParentRunId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidOpaqueId.mockReturnValue(true);
  });

  it('returns null (valid) when parent run exists in same workspace with no nesting', async () => {
    mocks.getRunHierarchyNode.mockResolvedValue(makeNode({ id: 'parent-run' }));

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBeNull();
  });

  it('returns error when parent run is not found', async () => {
    mocks.getRunHierarchyNode.mockResolvedValue(null);

    const error = await validateParentRunId({} as D1Database, 'space-1', 'missing-run');

    expect(error).toBe('Invalid parent_run_id: run not found');
  });

  it('returns error when parent run is in a different workspace', async () => {
    mocks.getRunHierarchyNode.mockResolvedValue(makeNode({ accountId: 'other-space' }));

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBe('Invalid parent_run_id: parent run must be in the same workspace');
  });

  it('walks the parent chain to validate depth', async () => {
    // Depth 1: parent-run -> null
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'parent-run',
      parentRunId: 'grandparent-run',
    }));
    // Depth 2: grandparent-run -> null
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'grandparent-run',
      parentRunId: null,
    }));

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBeNull();
    // Should have called getRunHierarchyNode twice (parent + grandparent)
    expect(mocks.getRunHierarchyNode).toHaveBeenCalledTimes(2);
  });

  it('rejects when nesting depth exceeds max (5)', async () => {
    // Create a chain of depth 5 already
    for (let i = 0; i < 5; i++) {
      mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
        id: `run-${i}`,
        parentRunId: i < 4 ? `run-${i + 1}` : null,
      }));
    }

    const error = await validateParentRunId({} as D1Database, 'space-1', 'run-0');

    expect(error).toContain('Run nesting depth exceeded');
  });

  it('detects cycles in run hierarchy', async () => {
    // run-A -> run-B -> run-A (cycle)
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'run-A',
      parentRunId: 'run-B',
    }));
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'run-B',
      parentRunId: 'run-A',
    }));

    const error = await validateParentRunId({} as D1Database, 'space-1', 'run-A');

    expect(error).toBe('Invalid parent_run_id: run hierarchy cycle detected');
  });

  it('returns error when hierarchy crosses workspaces', async () => {
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'parent-run',
      parentRunId: 'grandparent-run',
    }));
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'grandparent-run',
      accountId: 'other-space',
    }));

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBe('Invalid parent_run_id: run hierarchy crosses workspaces');
  });

  it('returns error when parent chain has a broken link', async () => {
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'parent-run',
      parentRunId: 'missing-run',
    }));
    mocks.getRunHierarchyNode.mockResolvedValueOnce(null);

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBe('Invalid parent_run_id: run hierarchy is broken');
  });

  it('returns error when a parentRunId in the chain is an invalid opaque ID', async () => {
    mocks.getRunHierarchyNode.mockResolvedValueOnce(makeNode({
      id: 'parent-run',
      parentRunId: 'bad id with spaces',
    }));
    mocks.isValidOpaqueId.mockReturnValue(false);

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    expect(error).toBe('Invalid parent_run_id: run hierarchy is broken');
  });
});

describe('resolveRunModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default model when no model is specified and workspace has none', async () => {
    mocks.getWorkspaceModel.mockResolvedValue(null);

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    expect(model).toBe('gpt-5.4-nano');
  });

  it('uses the workspace model when no request model is provided', async () => {
    mocks.getWorkspaceModel.mockResolvedValue({ aiModel: 'gpt-5.4-mini' });

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    expect(model).toBe('gpt-5.4-mini');
  });

  it('prefers the requested model over workspace model', async () => {
    mocks.getWorkspaceModel.mockResolvedValue({ aiModel: 'gpt-5.4-nano' });

    const model = await resolveRunModel({} as D1Database, 'space-1', 'gpt-5.4-mini');

    expect(model).toBe('gpt-5.4-mini');
  });

  it('falls back to default for unrecognized model', async () => {
    mocks.getWorkspaceModel.mockResolvedValue(null);

    const model = await resolveRunModel({} as D1Database, 'space-1', 'totally-unknown-model');

    expect(model).toBe('gpt-5.4-nano');
  });

  it('logs warning for suspicious model strings', async () => {
    mocks.getWorkspaceModel.mockResolvedValue(null);

    await resolveRunModel({} as D1Database, 'space-1', '<script>alert("xss")</script>');

    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('returns default when workspace aiModel is null', async () => {
    mocks.getWorkspaceModel.mockResolvedValue({ aiModel: null });

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    expect(model).toBe('gpt-5.4-nano');
  });
});
