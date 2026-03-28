import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

vi.mock('@/tools/loaders/mcp-tools', () => ({
  loadMcpTools: vi.fn().mockResolvedValue({
    tools: new Map(),
    clients: new Map(),
    failedServers: [],
  }),
}));

import { ToolResolver, createToolResolver } from '@/tools/resolver';
import { BUILTIN_TOOLS } from '@/tools/builtin';
import { loadMcpTools } from '@/tools/loaders/mcp-tools';

describe('ToolResolver', () => {
  const db = {} as D1Database;
  const spaceId = 'ws-test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolve', () => {
    it('resolves a builtin tool by name', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tool = resolver.resolve('file_read');
      expect(tool).toBeDefined();
      expect(tool!.builtin).toBe(true);
      expect(tool!.definition.name).toBe('file_read');
      expect(tool!.handler).toBeTypeOf('function');
    });

    it('returns undefined for unknown tools', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tool = resolver.resolve('nonexistent_tool');
      expect(tool).toBeUndefined();
    });

    it('returns undefined for invalid tool names', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      expect(resolver.resolve('')).toBeUndefined();
      expect(resolver.resolve(null as unknown as string)).toBeUndefined();
      expect(resolver.resolve(undefined as unknown as string)).toBeUndefined();
    });
  });

  describe('exists', () => {
    it('returns true for existing builtin tools', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      expect(resolver.exists('file_read')).toBe(true);
      expect(resolver.exists('container_start')).toBe(true);
    });

    it('returns false for nonexistent tools', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      expect(resolver.exists('does_not_exist')).toBe(false);
    });
  });

  describe('isBuiltin', () => {
    it('identifies builtin tools', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      expect(resolver.isBuiltin('file_read')).toBe(true);
      expect(resolver.isBuiltin('nonexistent')).toBe(false);
    });
  });

  describe('getAvailableTools', () => {
    it('returns all builtin tools when no MCP tools loaded', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const tools = resolver.getAvailableTools();
      expect(tools.length).toBe(BUILTIN_TOOLS.length);
    });

    it('includes MCP tools in the list', async () => {
      const mcpTool = {
        definition: {
          name: 'mcp_custom_tool',
          description: 'A custom MCP tool',
          category: 'mcp' as const,
          parameters: { type: 'object' as const, properties: {} },
        },
        handler: vi.fn(),
        builtin: false,
      };

      vi.mocked(loadMcpTools).mockResolvedValue({
        tools: new Map([['mcp_custom_tool', mcpTool]]),
        clients: new Map(),
        failedServers: [],
      });

      const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();

      const tools = resolver.getAvailableTools();
      expect(tools.some(t => t.name === 'mcp_custom_tool')).toBe(true);
    });
  });

  describe('disabledBuiltinTools', () => {
    it('hides disabled builtin tools from getAvailableTools', async () => {
      const resolver = new ToolResolver(db, spaceId, undefined, {
        disabledBuiltinTools: ['file_read', 'file_write'],
      });
      await resolver.init();

      const tools = resolver.getAvailableTools();
      expect(tools.some(t => t.name === 'file_read')).toBe(false);
      expect(tools.some(t => t.name === 'file_write')).toBe(false);
    });

    it('returns undefined when resolving disabled builtin tools', async () => {
      const resolver = new ToolResolver(db, spaceId, undefined, {
        disabledBuiltinTools: ['file_read'],
      });
      await resolver.init();

      expect(resolver.resolve('file_read')).toBeUndefined();
      expect(resolver.exists('file_read')).toBe(false);
      expect(resolver.isBuiltin('file_read')).toBe(false);
    });
  });

  describe('init idempotency', () => {
    it('does not reinitialize on second call', async () => {
      const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();
      await resolver.init();

      expect(loadMcpTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('mcpFailedServers', () => {
    it('exposes failed MCP server names', async () => {
      vi.mocked(loadMcpTools).mockResolvedValue({
        tools: new Map(),
        clients: new Map(),
        failedServers: ['broken_server'],
      });

      const env = {} as Env;
      const resolver = new ToolResolver(db, spaceId, env);
      await resolver.init();

      expect(resolver.mcpFailedServers).toEqual(['broken_server']);
    });
  });

  describe('getToolNamesByCategory', () => {
    it('returns tool names for a given category', async () => {
      const resolver = new ToolResolver(db, spaceId);
      await resolver.init();

      const fileTools = resolver.getToolNamesByCategory('file');
      expect(fileTools.length).toBeGreaterThan(0);
      expect(fileTools).toContain('file_read');
    });
  });

  describe('createToolResolver factory', () => {
    it('returns an initialized ToolResolver', async () => {
      const resolver = await createToolResolver(db, spaceId);
      expect(resolver).toBeInstanceOf(ToolResolver);
      expect(resolver.exists('file_read')).toBe(true);
    });
  });
});
