import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

import {
  CAPABILITY_SEARCH,
  CAPABILITY_FAMILIES,
  CAPABILITY_INVOKE,
  DISCOVERY_TOOLS,
  DISCOVERY_HANDLERS,
  capabilitySearchHandler,
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
} from '@/tools/builtin/discovery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRegistry = {
  search: vi.fn(),
  families: vi.fn(),
  get: vi.fn(),
  size: 42,
};

const mockExecutor = {
  execute: vi.fn(),
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    capabilityRegistry: mockRegistry as any,
    ...overrides,
  };
}

function makeContextWithExecutor(overrides: Partial<ToolContext> = {}): ToolContext {
  const ctx = makeContext(overrides) as any;
  ctx._toolExecutor = mockExecutor;
  return ctx;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('discovery tool definitions', () => {
  it('defines three tools', () => {
    expect(DISCOVERY_TOOLS).toHaveLength(3);
    const names = DISCOVERY_TOOLS.map((t) => t.name);
    expect(names).toContain('capability_search');
    expect(names).toContain('capability_families');
    expect(names).toContain('capability_invoke');
  });

  it('all tools have workspace category', () => {
    for (const def of DISCOVERY_TOOLS) {
      expect(def.category).toBe('workspace');
    }
  });

  it('DISCOVERY_HANDLERS maps all tools', () => {
    for (const def of DISCOVERY_TOOLS) {
      expect(DISCOVERY_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('capability_search requires query', () => {
    expect(CAPABILITY_SEARCH.parameters.required).toEqual(['query']);
  });

  it('capability_families has no required params', () => {
    expect(CAPABILITY_FAMILIES.parameters.required).toBeUndefined();
  });

  it('capability_invoke requires tool_name', () => {
    expect(CAPABILITY_INVOKE.parameters.required).toEqual(['tool_name']);
  });
});

// ---------------------------------------------------------------------------
// capabilitySearchHandler
// ---------------------------------------------------------------------------

describe('capabilitySearchHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when no registry is available', async () => {
    const ctx = makeContext({ capabilityRegistry: undefined });

    const result = JSON.parse(await capabilitySearchHandler({ query: 'test' }, ctx));

    expect(result.error).toContain('All tools are already available');
  });

  it('searches registry and returns discoverable results', async () => {
    mockRegistry.search.mockReturnValue([
      {
        id: 'tool:file_read',
        kind: 'tool',
        name: 'file_read',
        summary: 'Read a file',
        family: 'file',
        namespace: 'builtin',
        risk_level: 'low',
        discoverable: true,
      },
      {
        id: 'tool:secret_tool',
        kind: 'tool',
        name: 'secret_tool',
        summary: 'Hidden tool',
        family: 'internal',
        namespace: 'builtin',
        risk_level: 'high',
        discoverable: false,
      },
    ]);

    const result = JSON.parse(
      await capabilitySearchHandler({ query: 'file' }, makeContext()),
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('file_read');
    expect(result.total_available).toBe(42);
    expect(result.hint).toContain('capability_invoke');
  });

  it('uses custom limit', async () => {
    mockRegistry.search.mockReturnValue([]);

    await capabilitySearchHandler({ query: 'test', limit: 5 }, makeContext());

    expect(mockRegistry.search).toHaveBeenCalledWith('test', { limit: 5 });
  });

  it('defaults limit to 10', async () => {
    mockRegistry.search.mockReturnValue([]);

    await capabilitySearchHandler({ query: 'test' }, makeContext());

    expect(mockRegistry.search).toHaveBeenCalledWith('test', { limit: 10 });
  });
});

// ---------------------------------------------------------------------------
// capabilityFamiliesHandler
// ---------------------------------------------------------------------------

describe('capabilityFamiliesHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when no registry is available', async () => {
    const ctx = makeContext({ capabilityRegistry: undefined });

    const result = JSON.parse(await capabilityFamiliesHandler({}, ctx));
    expect(result.error).toContain('All tools are already available');
  });

  it('returns families and total count', async () => {
    mockRegistry.families.mockReturnValue([
      { family: 'file', count: 8 },
      { family: 'storage', count: 12 },
    ]);

    const result = JSON.parse(await capabilityFamiliesHandler({}, makeContext()));

    expect(result.families).toHaveLength(2);
    expect(result.families[0].family).toBe('file');
    expect(result.total_capabilities).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// capabilityInvokeHandler
// ---------------------------------------------------------------------------

describe('capabilityInvokeHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when tool_name is empty', async () => {
    await expect(
      capabilityInvokeHandler({ tool_name: '' }, makeContextWithExecutor()),
    ).rejects.toThrow('tool_name is required');
  });

  it('throws when trying to invoke itself', async () => {
    await expect(
      capabilityInvokeHandler(
        { tool_name: 'capability_invoke' },
        makeContextWithExecutor(),
      ),
    ).rejects.toThrow('cannot invoke itself');
  });

  it('throws when tool is not discoverable', async () => {
    mockRegistry.get.mockReturnValue({ discoverable: false });

    await expect(
      capabilityInvokeHandler(
        { tool_name: 'secret_tool' },
        makeContextWithExecutor(),
      ),
    ).rejects.toThrow('not available for invocation');
  });

  it('throws when tool executor is not available', async () => {
    const ctx = makeContext(); // no _toolExecutor
    mockRegistry.get.mockReturnValue({ discoverable: true });

    await expect(
      capabilityInvokeHandler({ tool_name: 'file_read' }, ctx),
    ).rejects.toThrow('Tool executor not available');
  });

  it('executes a tool and returns output', async () => {
    mockRegistry.get.mockReturnValue({ discoverable: true });
    mockExecutor.execute.mockResolvedValue({
      output: 'file content here',
    });

    const result = await capabilityInvokeHandler(
      { tool_name: 'file_read', arguments: { path: 'test.ts' } },
      makeContextWithExecutor(),
    );

    expect(result).toBe('file content here');
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'file_read',
        arguments: { path: 'test.ts' },
      }),
    );
  });

  it('throws when execution returns an error', async () => {
    mockRegistry.get.mockReturnValue({ discoverable: true });
    mockExecutor.execute.mockResolvedValue({
      output: '',
      error: 'permission denied',
    });

    await expect(
      capabilityInvokeHandler(
        { tool_name: 'file_read', arguments: { path: '/etc/shadow' } },
        makeContextWithExecutor(),
      ),
    ).rejects.toThrow('permission denied');
  });

  it('handles missing arguments gracefully', async () => {
    mockRegistry.get.mockReturnValue({ discoverable: true });
    mockExecutor.execute.mockResolvedValue({ output: 'ok' });

    const result = await capabilityInvokeHandler(
      { tool_name: 'some_tool' },
      makeContextWithExecutor(),
    );

    expect(result).toBe('ok');
    expect(mockExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'some_tool',
        arguments: {},
      }),
    );
  });

  it('allows invocation when registry does not have descriptor', async () => {
    mockRegistry.get.mockReturnValue(undefined); // no descriptor found

    mockExecutor.execute.mockResolvedValue({ output: 'result' });

    const result = await capabilityInvokeHandler(
      { tool_name: 'unknown_tool' },
      makeContextWithExecutor(),
    );

    expect(result).toBe('result');
  });

  it('allows invocation when no registry is present', async () => {
    const ctx = makeContextWithExecutor({ capabilityRegistry: undefined });
    mockExecutor.execute.mockResolvedValue({ output: 'no-reg-result' });

    const result = await capabilityInvokeHandler(
      { tool_name: 'some_tool' },
      ctx,
    );

    expect(result).toBe('no-reg-result');
  });
});
