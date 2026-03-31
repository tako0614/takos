import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// [Deno] vi.mock removed - manually stub imports from '@/tools/mcp-tools'
import { ToolResolver, createToolResolver } from '@/tools/resolver';
import { BUILTIN_TOOLS } from '@/tools/builtin';
import { loadMcpTools } from '@/tools/mcp-tools';


import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

  const db = {} as D1Database;
  const spaceId = 'ws-test';
  
    Deno.test('ToolResolver - resolve - resolves a builtin tool by name', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tool = resolver.resolve('file_read');
      assert(tool !== undefined);
      assertEquals(tool!.builtin, true);
      assertEquals(tool!.definition.name, 'file_read');
      assertEquals(typeof tool!.handler, 'function');
})
    Deno.test('ToolResolver - resolve - returns undefined for unknown tools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tool = resolver.resolve('nonexistent_tool');
      assertEquals(tool, undefined);
})
    Deno.test('ToolResolver - resolve - returns undefined for invalid tool names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      assertEquals(resolver.resolve(''), undefined);
      assertEquals(resolver.resolve(null as unknown as string), undefined);
      assertEquals(resolver.resolve(undefined as unknown as string), undefined);
})  
  
    Deno.test('ToolResolver - exists - returns true for existing builtin tools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      assertEquals(resolver.exists('file_read'), true);
      assertEquals(resolver.exists('container_start'), true);
})
    Deno.test('ToolResolver - exists - returns false for nonexistent tools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      assertEquals(resolver.exists('does_not_exist'), false);
})  
  
    Deno.test('ToolResolver - isBuiltin - identifies builtin tools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      assertEquals(resolver.isBuiltin('file_read'), true);
      assertEquals(resolver.isBuiltin('nonexistent'), false);
})  
  
    Deno.test('ToolResolver - getAvailableTools - returns all builtin tools when no MCP tools loaded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tools = resolver.getAvailableTools();
      assertEquals(tools.length, BUILTIN_TOOLS.length);
})
    Deno.test('ToolResolver - getAvailableTools - includes MCP tools in the list', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mcpTool = {
        definition: {
          name: 'mcp_custom_tool',
          description: 'A custom MCP tool',
          category: 'mcp' as const,
          parameters: { type: 'object' as const, properties: {} },
        },
        handler: ((..._args: any[]) => undefined) as any,
        builtin: false,
      };

      loadMcpTools = (async () => ({
        tools: new Map([['mcp_custom_tool', mcpTool]]),
        clients: new Map(),
        failedServers: [],
      })) as any;

      const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();

      const tools = resolver.getAvailableTools();
      assertEquals(tools.some(t => t.name === 'mcp_custom_tool'), true);
})  
  
    Deno.test('ToolResolver - disabledBuiltinTools - hides disabled builtin tools from getAvailableTools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId, undefined, {
        disabledBuiltinTools: ['file_read', 'file_write'],
      });
      await resolver.init();

      const tools = resolver.getAvailableTools();
      assertEquals(tools.some(t => t.name === 'file_read'), false);
      assertEquals(tools.some(t => t.name === 'file_write'), false);
})
    Deno.test('ToolResolver - disabledBuiltinTools - returns undefined when resolving disabled builtin tools', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId, undefined, {
        disabledBuiltinTools: ['file_read'],
      });
      await resolver.init();

      assertEquals(resolver.resolve('file_read'), undefined);
      assertEquals(resolver.exists('file_read'), false);
      assertEquals(resolver.isBuiltin('file_read'), false);
})  
  
    Deno.test('ToolResolver - init idempotency - does not reinitialize on second call', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();
      await resolver.init();

      assertSpyCalls(loadMcpTools, 1);
})  
  
    Deno.test('ToolResolver - mcpFailedServers - exposes failed MCP server names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  loadMcpTools = (async () => ({
        tools: new Map(),
        clients: new Map(),
        failedServers: ['broken_server'],
      })) as any;

      const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();

      assertEquals(resolver.mcpFailedServers, ['broken_server']);
})  
  
    Deno.test('ToolResolver - getToolNamesByCategory - returns tool names for a given category', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const fileTools = resolver.getToolNamesByCategory('file');
      assert(fileTools.length > 0);
      assertStringIncludes(fileTools, 'file_read');
})  
  
    Deno.test('ToolResolver - createToolResolver factory - returns an initialized ToolResolver', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const resolver = await createToolResolver(db, spaceId);
      assert(resolver instanceof ToolResolver);
      assertEquals(resolver.exists('file_read'), true);
})  