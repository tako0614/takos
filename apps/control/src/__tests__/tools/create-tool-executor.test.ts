import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';
import type { ToolContext, ToolDefinition } from '@/tools/types';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mockState = {
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

  const handler = async (_args: Record<string, unknown>, ctx: ToolContext) => JSON.stringify({
    hasRegistry: !!ctx.capabilityRegistry,
    canInvokeFromContext: typeof (ctx as ToolContext & {
      _toolExecutor?: { execute: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown> };
    })._toolExecutor?.execute === 'function',
  });

  const resolver = {
    getAvailableTools: () => [tool],
    resolve: (name: string) => (
      name === tool.name
        ? { definition: tool, builtin: true, handler }
        : undefined
    ),
    get mcpFailedServers() { return []; },
  };

  const resolveAllowedCapabilities = async () => ({
    ctx: { role: 'editor' as const },
    allowed: new Set(['repo.read']),
  });

  return { handler, resolver, resolveAllowedCapabilities };
};

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/capabilities'
// [Deno] vi.mock removed - manually stub imports from '@/tools/resolver'
import { createToolExecutor } from '@/tools/executor';


  Deno.test('createToolExecutor - attaches the per-run capability registry and executor reference for discovery tools', async () => {
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

    assertSpyCalls(mockState.handler, 1);
    assertEquals(JSON.parse(result.output), {
      hasRegistry: true,
      canInvokeFromContext: true,
    });
})