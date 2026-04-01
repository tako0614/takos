import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import {
  CAPABILITY_FAMILIES,
  CAPABILITY_INVOKE,
  CAPABILITY_SEARCH,
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
  capabilitySearchHandler,
  DISCOVERY_HANDLERS,
  DISCOVERY_TOOLS,
} from '@/tools/builtin/discovery';

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test('discovery tool definitions - defines three tools', () => {
  assertEquals(DISCOVERY_TOOLS.length, 3);
  assertEquals(DISCOVERY_TOOLS.map((t) => t.name), [
    'capability_search',
    'capability_families',
    'capability_invoke',
  ]);
});

Deno.test('discovery tool definitions - all tools have workspace category', () => {
  for (const def of DISCOVERY_TOOLS) {
    assertEquals(def.category, 'workspace');
  }
});

Deno.test('discovery tool definitions - DISCOVERY_HANDLERS maps all tools', () => {
  for (const def of DISCOVERY_TOOLS) {
    assert(def.name in DISCOVERY_HANDLERS);
  }
});

Deno.test('discovery tool definitions - parameter contracts are stable', () => {
  assertEquals(CAPABILITY_SEARCH.parameters.required, ['query']);
  assertEquals(CAPABILITY_FAMILIES.parameters.required, undefined);
  assertEquals(CAPABILITY_INVOKE.parameters.required, ['tool_name']);
});

Deno.test('capabilitySearchHandler - returns error when no registry is available', async () => {
  const result = JSON.parse(
    await capabilitySearchHandler({ query: 'test' }, makeContext({ capabilityRegistry: undefined })),
  );
  assertStringIncludes(result.error, 'All tools are already available');
});

Deno.test('capabilitySearchHandler - searches registry and returns discoverable results', async () => {
  const capabilityRegistry = {
    size: 42,
    search: () => [
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
    ],
    families: () => [],
    get: (_key: string) => undefined,
  };

  const result = JSON.parse(
    await capabilitySearchHandler({ query: 'file' }, makeContext({ capabilityRegistry: capabilityRegistry as any })),
  );

  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].name, 'file_read');
  assertEquals(result.total_available, 42);
  assertStringIncludes(result.hint, 'capability_invoke');
});

Deno.test('capabilitySearchHandler - uses custom limit', async () => {
  const calls: Array<[string, { limit: number }]> = [];
  const capabilityRegistry = {
    size: 42,
    search: (query: string, opts: { limit: number }) => {
      calls.push([query, opts]);
      return [];
    },
    families: () => [],
    get: (_key: string) => undefined,
  };

  await capabilitySearchHandler({ query: 'test', limit: 5 }, makeContext({ capabilityRegistry: capabilityRegistry as any }));
  assertEquals(calls, [['test', { limit: 5 }]]);
});

Deno.test('capabilitySearchHandler - defaults limit to 10', async () => {
  const calls: Array<[string, { limit: number }]> = [];
  const capabilityRegistry = {
    size: 42,
    search: (query: string, opts: { limit: number }) => {
      calls.push([query, opts]);
      return [];
    },
    families: () => [],
    get: (_key: string) => undefined,
  };

  await capabilitySearchHandler({ query: 'test' }, makeContext({ capabilityRegistry: capabilityRegistry as any }));
  assertEquals(calls, [['test', { limit: 10 }]]);
});

Deno.test('capabilityFamiliesHandler - returns error when no registry is available', async () => {
  const result = JSON.parse(await capabilityFamiliesHandler({}, makeContext({ capabilityRegistry: undefined })));
  assertStringIncludes(result.error, 'All tools are already available');
});

Deno.test('capabilityFamiliesHandler - returns families and total count', async () => {
  const capabilityRegistry = {
    size: 42,
    search: () => [],
    families: () => [
      { family: 'file', count: 8 },
      { family: 'storage', count: 12 },
    ],
    get: (_key: string) => undefined,
  };

  const result = JSON.parse(await capabilityFamiliesHandler({}, makeContext({ capabilityRegistry: capabilityRegistry as any })));
  assertEquals(result.families.length, 2);
  assertEquals(result.families[0].family, 'file');
  assertEquals(result.total_capabilities, 42);
});

Deno.test('capabilityInvokeHandler - throws when tool_name is empty', async () => {
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: '' },
      makeContext({ capabilityRegistry: { get: async () => undefined } as any } as any),
    );
  }, 'tool_name is required');
});

Deno.test('capabilityInvokeHandler - throws when trying to invoke itself', async () => {
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: 'capability_invoke' },
      makeContext({ capabilityRegistry: { get: async () => undefined } as any } as any),
    );
  }, 'cannot invoke itself');
});

Deno.test('capabilityInvokeHandler - throws when tool is not discoverable', async () => {
  const capabilityRegistry = { get: (_key: string) => ({ discoverable: false }) };
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: 'secret_tool' },
      makeContext({
        capabilityRegistry: capabilityRegistry as any,
      } as any),
    );
  }, 'not available for invocation');
});

Deno.test('capabilityInvokeHandler - throws when tool executor is not available', async () => {
  const capabilityRegistry = { get: (_key: string) => ({ discoverable: true }) };
  await assertRejects(async () => {
    await capabilityInvokeHandler(
      { tool_name: 'file_read' },
      makeContext({ capabilityRegistry: capabilityRegistry as any } as any),
    );
  }, 'Tool executor not available');
});

Deno.test('capabilityInvokeHandler - executes a tool and returns output', async () => {
  const capabilityRegistry = { get: (_key: string) => ({ discoverable: true }) };
  const ctx = makeContext({
    capabilityRegistry: capabilityRegistry as any,
    _toolExecutor: {
      execute: async () => ({ output: 'file content here' }),
    } as any,
  } as any);

  const result = await capabilityInvokeHandler(
    { tool_name: 'file_read', arguments: { path: 'test.ts' } },
    ctx,
  );

  assertStringIncludes(result, 'file content here');
});
