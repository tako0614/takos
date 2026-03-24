import { describe, expect, it } from 'vitest';
import {
  buildToolDescriptor,
  buildSkillDescriptor,
  buildCustomSkillDescriptor,
  buildMcpToolDescriptor,
  applyPolicyForRole,
} from '@/tools/descriptor-builder';
import { BUILTIN_TOOLS } from '@/tools/builtin';

describe('descriptor-builder', () => {
  describe('buildToolDescriptor', () => {
    it('converts a builtin tool to a descriptor', () => {
      const fileRead = BUILTIN_TOOLS.find(t => t.name === 'file_read')!;
      const descriptor = buildToolDescriptor(fileRead);

      expect(descriptor.id).toBe('tool:file_read');
      expect(descriptor.kind).toBe('tool');
      expect(descriptor.namespace).toBe('file');
      expect(descriptor.name).toBe('file_read');
      expect(descriptor.summary).toBe(fileRead.description);
      expect(descriptor.risk_level).toBe('none');
      expect(descriptor.side_effects).toBe(false);
      expect(descriptor.source).toBe('builtin');
      expect(descriptor.discoverable).toBe(true);
      expect(descriptor.selectable).toBe(true);
    });

    it('includes family from namespace map', () => {
      const containerStart = BUILTIN_TOOLS.find(t => t.name === 'container_start')!;
      const descriptor = buildToolDescriptor(containerStart);

      expect(descriptor.family).toBe('container.lifecycle');
    });

    it('includes required_capabilities if present', () => {
      const webFetch = BUILTIN_TOOLS.find(t => t.name === 'web_fetch')!;
      const descriptor = buildToolDescriptor(webFetch);

      expect(descriptor.tags).toBeDefined();
    });
  });

  describe('buildSkillDescriptor', () => {
    it('converts an official skill to a descriptor', () => {
      const descriptor = buildSkillDescriptor({
        id: 'research-brief',
        version: '1.0.0',
        locale: 'en',
        category: 'research',
        priority: 100,
        activation_tags: ['research'],
        execution_contract: {
          preferred_tools: [],
          durable_output_hints: [],
          output_modes: [],
          required_mcp_servers: [],
          template_ids: [],
        },
        name: 'Research Brief',
        description: 'Investigate a topic.',
        instructions: 'Gather facts.',
        triggers: ['research', 'investigate'],
      });

      expect(descriptor.id).toBe('skill:research-brief');
      expect(descriptor.kind).toBe('skill');
      expect(descriptor.namespace).toBe('web');
      expect(descriptor.source).toBe('official_skill');
      expect(descriptor.triggers).toEqual(['research', 'investigate']);
    });
  });

  describe('buildCustomSkillDescriptor', () => {
    it('converts a custom skill row to a descriptor', () => {
      const descriptor = buildCustomSkillDescriptor({
        id: 'my-skill',
        name: 'My Skill',
        description: 'A custom skill.',
        triggers: ['custom', 'test'],
        category: 'research',
      });

      expect(descriptor.id).toBe('skill:my-skill');
      expect(descriptor.kind).toBe('skill');
      expect(descriptor.source).toBe('custom_skill');
    });

    it('handles missing fields gracefully', () => {
      const descriptor = buildCustomSkillDescriptor({
        id: 'minimal',
        name: 'Minimal',
        description: 'No triggers or category.',
      });

      expect(descriptor.triggers).toEqual([]);
      expect(descriptor.family).toBe('skill.custom');
    });
  });

  describe('buildMcpToolDescriptor', () => {
    it('creates a descriptor with server metadata', () => {
      const descriptor = buildMcpToolDescriptor(
        {
          name: 'my_tool',
          description: 'A tool from my-server.',
          category: 'mcp',
          parameters: { type: 'object', properties: {} },
        },
        { serverName: 'my-server', sourceType: 'external' },
      );

      expect(descriptor.id).toBe('tool:my_tool');
      expect(descriptor.namespace).toBe('mcp');
      expect(descriptor.source).toBe('mcp');
      expect(descriptor.family).toBe('mcp.my-server');
      expect(descriptor.risk_level).toBe('medium');
      expect(descriptor.tags).toContain('mcp.my-server');
    });

    it('sets lower risk for managed MCP servers', () => {
      const descriptor = buildMcpToolDescriptor(
        {
          name: 'managed_tool',
          description: 'A managed MCP tool.',
          category: 'mcp',
          parameters: { type: 'object', properties: {} },
        },
        { serverName: 'my-worker', sourceType: 'managed' },
      );

      expect(descriptor.risk_level).toBe('low');
      expect(descriptor.family).toBe('mcp.my-worker');
    });

    it('infers server name from namespaced tool name', () => {
      const descriptor = buildMcpToolDescriptor({
        name: 'github__list_repos',
        description: 'List repos.',
        category: 'mcp',
        parameters: { type: 'object', properties: {} },
      });

      expect(descriptor.family).toBe('mcp.github');
    });

    it('falls back to mcp.external for plain tool names', () => {
      const descriptor = buildMcpToolDescriptor({
        name: 'plain_tool',
        description: 'No server prefix.',
        category: 'mcp',
        parameters: { type: 'object', properties: {} },
      });

      expect(descriptor.family).toBe('mcp.external');
    });
  });

  describe('applyPolicyForRole', () => {
    it('hides high-risk tools from viewers', () => {
      const descriptors = [
        buildToolDescriptor(BUILTIN_TOOLS.find(t => t.name === 'deploy_frontend')!),
        buildToolDescriptor(BUILTIN_TOOLS.find(t => t.name === 'file_read')!),
      ];

      const result = applyPolicyForRole(descriptors, 'viewer');
      const deploy = result.find(d => d.name === 'deploy_frontend')!;
      const fileRead = result.find(d => d.name === 'file_read')!;

      expect(deploy.discoverable).toBe(false);
      expect(deploy.selectable).toBe(false);
      expect(fileRead.discoverable).toBe(true);
      expect(fileRead.selectable).toBe(true);
    });

    it('restricts web/browser tools without egress.http capability', () => {
      const descriptors = [
        buildToolDescriptor(BUILTIN_TOOLS.find(t => t.name === 'web_fetch')!),
        buildToolDescriptor(BUILTIN_TOOLS.find(t => t.name === 'file_read')!),
      ];

      const result = applyPolicyForRole(descriptors, 'editor', []);
      const webFetch = result.find(d => d.name === 'web_fetch')!;
      const fileRead = result.find(d => d.name === 'file_read')!;

      expect(webFetch.selectable).toBe(false);
      expect(fileRead.selectable).toBe(true);
    });
  });
});
