import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getRunHierarchyNode: ((..._args: any[]) => undefined) as any,
  getWorkspaceModel: ((..._args: any[]) => undefined) as any,
  isValidOpaqueId: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/runs/create-thread-run-store'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/db-guards'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
// We need to mock agent module for DEFAULT_MODEL_ID and normalizeModelId
// [Deno] vi.mock removed - manually stub imports from '@/services/agent'
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


  Deno.test('validateParentRunId - returns null (valid) when parent run exists in same workspace with no nesting', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => makeNode({ id: 'parent-run' })) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, null);
})
  Deno.test('validateParentRunId - returns error when parent run is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => null) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'missing-run');

    assertEquals(error, 'Invalid parent_run_id: run not found');
})
  Deno.test('validateParentRunId - returns error when parent run is in a different workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => makeNode({ accountId: 'other-space' })) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, 'Invalid parent_run_id: parent run must be in the same workspace');
})
  Deno.test('validateParentRunId - walks the parent chain to validate depth', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  // Depth 1: parent-run -> null
    mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'parent-run',
      parentRunId: 'grandparent-run',
    })) as any;
    // Depth 2: grandparent-run -> null
    mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'grandparent-run',
      parentRunId: null,
    })) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, null);
    // Should have called getRunHierarchyNode twice (parent + grandparent)
    assertSpyCalls(mocks.getRunHierarchyNode, 2);
})
  Deno.test('validateParentRunId - rejects when nesting depth exceeds max (5)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  // Create a chain of depth 5 already
    for (let i = 0; i < 5; i++) {
      mocks.getRunHierarchyNode = (async () => makeNode({
        id: `run-${i}`,
        parentRunId: i < 4 ? `run-${i + 1}` : null,
      })) as any;
    }

    const error = await validateParentRunId({} as D1Database, 'space-1', 'run-0');

    assertStringIncludes(error, 'Run nesting depth exceeded');
})
  Deno.test('validateParentRunId - detects cycles in run hierarchy', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  // run-A -> run-B -> run-A (cycle)
    mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'run-A',
      parentRunId: 'run-B',
    })) as any;
    mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'run-B',
      parentRunId: 'run-A',
    })) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'run-A');

    assertEquals(error, 'Invalid parent_run_id: run hierarchy cycle detected');
})
  Deno.test('validateParentRunId - returns error when hierarchy crosses workspaces', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'parent-run',
      parentRunId: 'grandparent-run',
    })) as any;
    mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'grandparent-run',
      accountId: 'other-space',
    })) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, 'Invalid parent_run_id: run hierarchy crosses workspaces');
})
  Deno.test('validateParentRunId - returns error when parent chain has a broken link', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'parent-run',
      parentRunId: 'missing-run',
    })) as any;
    mocks.getRunHierarchyNode = (async () => null) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, 'Invalid parent_run_id: run hierarchy is broken');
})
  Deno.test('validateParentRunId - returns error when a parentRunId in the chain is an invalid opaque ID', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.getRunHierarchyNode = (async () => makeNode({
      id: 'parent-run',
      parentRunId: 'bad id with spaces',
    })) as any;
    mocks.isValidOpaqueId = (() => false) as any;

    const error = await validateParentRunId({} as D1Database, 'space-1', 'parent-run');

    assertEquals(error, 'Invalid parent_run_id: run hierarchy is broken');
})

  Deno.test('resolveRunModel - returns the default model when no model is specified and workspace has none', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => null) as any;

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    assertEquals(model, 'gpt-5.4-nano');
})
  Deno.test('resolveRunModel - uses the workspace model when no request model is provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => ({ aiModel: 'gpt-5.4-mini' })) as any;

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    assertEquals(model, 'gpt-5.4-mini');
})
  Deno.test('resolveRunModel - prefers the requested model over workspace model', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => ({ aiModel: 'gpt-5.4-nano' })) as any;

    const model = await resolveRunModel({} as D1Database, 'space-1', 'gpt-5.4-mini');

    assertEquals(model, 'gpt-5.4-mini');
})
  Deno.test('resolveRunModel - falls back to default for unrecognized model', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => null) as any;

    const model = await resolveRunModel({} as D1Database, 'space-1', 'totally-unknown-model');

    assertEquals(model, 'gpt-5.4-nano');
})
  Deno.test('resolveRunModel - logs warning for suspicious model strings', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => null) as any;

    await resolveRunModel({} as D1Database, 'space-1', '<script>alert("xss")</script>');

    assert(mocks.logWarn.calls.length > 0);
})
  Deno.test('resolveRunModel - returns default when workspace aiModel is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getWorkspaceModel = (async () => ({ aiModel: null })) as any;

    const model = await resolveRunModel({} as D1Database, 'space-1', undefined);

    assertEquals(model, 'gpt-5.4-nano');
})