import { describe, expect, it, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';
import type { ToolContext, ToolDefinition } from '@/tools/types';

const mockState = vi.hoisted(() => {
  const tool: ToolDefinition = {
    name: 'file_read',
    description: 'Read a file',
    category: 'file',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  const handler = vi.fn(async (_args: Record<string, unknown>, ctx: ToolContext) => JSON.stringify({
    hasRegistry: !!ctx.capabilityRegistry,
    canInvokeFromContext: typeof (ctx as ToolContext & {
      _toolExecutor?: { execute: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown> };
    })._toolExecutor?.execute === 'function',
  }));

  const resolver = {
    getAvailableTools: () => [tool],
    resolve: (name: string) => (
      name === tool.name
        ? { definition: tool, builtin: true, handler }
        : undefined
    ),
    get mcpFailedServers() { return []; },
  };

  const resolveAllowedCapabilities = vi.fn(async () => ({
    ctx: { role: 'editor' as const },
    allowed: new Set(['repo.read']),
  }));

  return { handler, resolver, resolveAllowedCapabilities };
});

vi.mock('@/services/platform/capabilities', () => ({
  resolveAllowedCapabilities: mockState.resolveAllowedCapabilities,
}));

vi.mock('@/tools/resolver', () => ({
  createToolResolver: vi.fn(async () => mockState.resolver),
}));

import { createToolExecutor } from '@/tools/executor';

describe('createToolExecutor', () => {
  it('attaches the per-run capability registry and executor reference for discovery tools', async () => {
    const executor = await createToolExecutor(
      {} as Env,
      {} as D1Database,
      undefined as R2Bucket | undefined,
      'space-1',
      undefined,
      'thread-1',
      'run-1',
      'user-1',
    );

    const result = await executor.execute({
      id: 'call-1',
      name: 'file_read',
      arguments: {},
    });

    expect(mockState.handler).toHaveBeenCalledOnce();
    expect(JSON.parse(result.output)).toEqual({
      hasRegistry: true,
      canInvokeFromContext: true,
    });
  });
});
