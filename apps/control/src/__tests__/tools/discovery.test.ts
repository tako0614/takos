import { describe, expect, it, beforeEach } from 'vitest';
import {
  capabilitySearchHandler,
  capabilityFamiliesHandler,
  capabilityInvokeHandler,
} from '@/tools/builtin/discovery';
import { CapabilityRegistry } from '@/tools/capability-registry';
import type { CapabilityDescriptor } from '@/tools/capability-types';
import type { ToolContext } from '@/tools/types';

function makeDescriptor(overrides: Partial<CapabilityDescriptor> & { id: string; name: string }): CapabilityDescriptor {
  return {
    kind: 'tool',
    namespace: 'file',
    summary: 'A test tool',
    tags: [],
    risk_level: 'none',
    side_effects: false,
    source: 'builtin',
    discoverable: true,
    selectable: true,
    ...overrides,
  };
}

function makeContext(registry?: CapabilityRegistry): ToolContext {
  return { capabilityRegistry: registry } as unknown as ToolContext;
}

describe('discovery tools', () => {
  let registry: CapabilityRegistry;
  let ctx: ToolContext;

  beforeEach(() => {
    registry = new CapabilityRegistry();
    registry.register(makeDescriptor({
      id: 'tool:file_read',
      name: 'file_read',
      summary: 'Read file contents',
      tags: ['file', 'read'],
      family: 'file.ops',
    }));
    registry.register(makeDescriptor({
      id: 'tool:browser_open',
      name: 'browser_open',
      namespace: 'browser',
      summary: 'Open a browser',
      tags: ['browser'],
      family: 'browser.nav',
    }));
    ctx = makeContext(registry);
  });

  describe('capability_search', () => {
    it('returns matching results for a query', async () => {
      const result = JSON.parse(await capabilitySearchHandler({ query: 'file read' }, ctx));
      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe('file_read');
    });

    it('respects limit parameter', async () => {
      const result = JSON.parse(await capabilitySearchHandler({ query: 'file browser', limit: 1 }, ctx));
      expect(result.results).toHaveLength(1);
    });

    it('filters out non-discoverable entries', async () => {
      registry.register(makeDescriptor({
        id: 'tool:hidden',
        name: 'hidden_tool',
        summary: 'Hidden from discovery',
        tags: ['hidden'],
        discoverable: false, selectable: false,
      }));

      const result = JSON.parse(await capabilitySearchHandler({ query: 'hidden', limit: 10 }, ctx));
      expect(result.results.every((r: { name: string }) => r.name !== 'hidden_tool')).toBe(true);
    });

    it('returns total_available count', async () => {
      const result = JSON.parse(await capabilitySearchHandler({ query: 'file' }, ctx));
      expect(result.total_available).toBe(registry.size);
    });

    it('returns guidance when registry not attached', async () => {
      const bareCtx = makeContext(undefined);
      const result = JSON.parse(await capabilitySearchHandler({ query: 'test' }, bareCtx));
      expect(result.error).toContain('already available');
    });
  });

  describe('capability_families', () => {
    it('returns family list with counts', async () => {
      const result = JSON.parse(await capabilityFamiliesHandler({}, ctx));
      expect(result.families).toContainEqual({ family: 'file.ops', count: 1 });
      expect(result.families).toContainEqual({ family: 'browser.nav', count: 1 });
      expect(result.total_capabilities).toBe(2);
    });

    it('returns guidance when registry not attached', async () => {
      const bareCtx = makeContext(undefined);
      const result = JSON.parse(await capabilityFamiliesHandler({}, bareCtx));
      expect(result.error).toContain('already available');
    });
  });

  describe('per-run isolation', () => {
    it('different contexts have different registries', async () => {
      const registry2 = new CapabilityRegistry();
      registry2.register(makeDescriptor({
        id: 'tool:only_in_ctx2',
        name: 'only_in_ctx2',
        summary: 'Only in ctx2',
        tags: ['ctx2'],
      }));
      const ctx2 = makeContext(registry2);

      // ctx1 should not see ctx2's tool
      const r1 = JSON.parse(await capabilitySearchHandler({ query: 'ctx2' }, ctx));
      expect(r1.results).toHaveLength(0);

      // ctx2 should see its own tool
      const r2 = JSON.parse(await capabilitySearchHandler({ query: 'ctx2' }, ctx2));
      expect(r2.results).toHaveLength(1);
      expect(r2.results[0].name).toBe('only_in_ctx2');
    });
  });

  describe('capability_invoke', () => {
    it('throws when tool_name is missing', async () => {
      await expect(capabilityInvokeHandler({}, ctx)).rejects.toThrow('tool_name is required');
    });

    it('throws when executor is not available', async () => {
      await expect(capabilityInvokeHandler({ tool_name: 'file_read' }, ctx)).rejects.toThrow('Tool executor not available');
    });

    it('executes a tool via injected executor', async () => {
      const mockExecutor = {
        execute: async (call: { name: string }) => ({
          output: `executed ${call.name}`,
        }),
      };
      const ctxWithExecutor = {
        ...ctx,
        _toolExecutor: mockExecutor,
      } as unknown as ToolContext;

      const result = await capabilityInvokeHandler(
        { tool_name: 'file_read', arguments: { path: '/test' } },
        ctxWithExecutor,
      );
      expect(result).toBe('executed file_read');
    });

    it('throws on executor error (visible to LangGraph error tracking)', async () => {
      const mockExecutor = {
        execute: async () => ({
          output: '',
          error: 'Unknown tool: nonexistent',
        }),
      };
      const ctxWithExecutor = {
        ...ctx,
        _toolExecutor: mockExecutor,
      } as unknown as ToolContext;

      await expect(
        capabilityInvokeHandler({ tool_name: 'nonexistent' }, ctxWithExecutor),
      ).rejects.toThrow('Unknown tool');
    });

    it('blocks invocation of non-discoverable tools (policy gate)', async () => {
      // Add a tool that is NOT discoverable
      registry.register(makeDescriptor({
        id: 'tool:deploy_frontend',
        name: 'deploy_frontend',
        discoverable: false, selectable: false,
      }));

      const mockExecutor = {
        execute: async (call: { name: string }) => ({ output: `executed ${call.name}` }),
      };
      const ctxWithExecutor = {
        ...ctx,
        _toolExecutor: mockExecutor,
      } as unknown as ToolContext;

      await expect(
        capabilityInvokeHandler({ tool_name: 'deploy_frontend' }, ctxWithExecutor),
      ).rejects.toThrow('not available for invocation');
    });

    it('blocks self-invocation to prevent recursion', async () => {
      const mockExecutor = {
        execute: async (call: { name: string }) => ({ output: `executed ${call.name}` }),
      };
      const ctxWithExecutor = {
        ...ctx,
        _toolExecutor: mockExecutor,
      } as unknown as ToolContext;

      await expect(
        capabilityInvokeHandler({ tool_name: 'capability_invoke' }, ctxWithExecutor),
      ).rejects.toThrow('cannot invoke itself');
    });

    it('allows invocation of discoverable tools', async () => {
      // browser_open is discoverable (default policy)
      const mockExecutor = {
        execute: async (call: { name: string }) => ({ output: `executed ${call.name}` }),
      };
      const ctxWithExecutor = {
        ...ctx,
        _toolExecutor: mockExecutor,
      } as unknown as ToolContext;

      const result = await capabilityInvokeHandler(
        { tool_name: 'browser_open', arguments: {} },
        ctxWithExecutor,
      );
      expect(result).toBe('executed browser_open');
    });
  });
});
