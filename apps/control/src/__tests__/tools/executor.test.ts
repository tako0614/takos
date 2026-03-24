import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';
import { ToolExecutor } from '@/tools/executor';
import type { ToolContext, ToolDefinition } from '@/tools/types';

function createTool(name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    category: 'agent',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    ...overrides,
  };
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-1',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    role: 'editor',
    capabilities: ['repo.read'],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

function createExecutor(tools: ToolDefinition[], contextOverrides: Partial<ToolContext> = {}) {
  const registry = new Map(tools.map((tool) => [tool.name, {
    definition: tool,
    builtin: false,
    handler: vi.fn(async () => 'ok'),
  }]));

  const resolver = {
    getAvailableTools: () => tools,
    resolve: (name: string) => registry.get(name),
    get mcpFailedServers() { return []; },
  };

  const sessionState = {
    beginExecution: () => undefined,
    endExecution: () => {},
  };

  return new ToolExecutor(
    resolver as never,
    createContext(contextOverrides),
    sessionState as never,
  );
}

describe('ToolExecutor visibility filtering', () => {
  it('hides capability-gated and dynamic MCP tools that are not executable in this run', () => {
    const executor = createExecutor([
      createTool('web_search'),
      createTool('managed__tool', { required_roles: ['owner', 'admin', 'editor'] }),
      createTool('external__tool', {
        required_roles: ['owner', 'admin', 'editor'],
        required_capabilities: ['egress.http'],
      }),
    ]);

    expect(executor.getAvailableTools().map((tool) => tool.name)).toEqual([
      'web_search',
      'managed__tool',
    ]);
  });

  it('hides editor-only dynamic tools from viewers', () => {
    const executor = createExecutor([
      createTool('managed__tool', { required_roles: ['owner', 'admin', 'editor'] }),
    ], {
      role: 'viewer',
      capabilities: ['repo.read', 'storage.read'],
    });

    expect(executor.getAvailableTools()).toEqual([]);
  });

  it('propagates run-level abort signals into tool handlers', async () => {
    const controller = new AbortController();
    controller.abort(new Error('run aborted'));

    const tool = createTool('managed__tool');
    const handler = vi.fn(async (_args, ctx) => {
      if (ctx.abortSignal?.aborted) {
        throw (ctx.abortSignal.reason instanceof Error
          ? ctx.abortSignal.reason
          : new Error(String(ctx.abortSignal.reason)));
      }
      return 'ok';
    });

    const registry = new Map([[tool.name, {
      definition: tool,
      builtin: false,
      handler,
    }]]);

    const resolver = {
      getAvailableTools: () => [tool],
      resolve: (name: string) => registry.get(name),
      get mcpFailedServers() { return []; },
    };

    const sessionState = {
      beginExecution: () => undefined,
      endExecution: () => {},
    };

    const executor = new ToolExecutor(
      resolver as never,
      createContext({ abortSignal: controller.signal }),
      sessionState as never,
    );

    const result = await executor.execute({
      id: 'call-1',
      name: tool.name,
      arguments: {},
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(result.error).toContain('run aborted');
  });
});
