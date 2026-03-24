import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLS } from '@/tools/builtin';
import { TOOL_NAMESPACE_MAP } from '@/tools/namespace-map';

describe('namespace-map', () => {
  it('has an entry for every builtin tool', () => {
    const unmapped: string[] = [];
    for (const tool of BUILTIN_TOOLS) {
      if (!TOOL_NAMESPACE_MAP[tool.name]) {
        unmapped.push(tool.name);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('has no entries for non-existent tools', () => {
    const builtinNames = new Set(BUILTIN_TOOLS.map(t => t.name));
    const extra: string[] = [];
    for (const name of Object.keys(TOOL_NAMESPACE_MAP)) {
      if (!builtinNames.has(name)) {
        extra.push(name);
      }
    }
    expect(extra).toEqual([]);
  });

  it('all entries have valid namespace and family', () => {
    for (const [name, meta] of Object.entries(TOOL_NAMESPACE_MAP)) {
      expect(meta.namespace).toBeTruthy();
      expect(meta.family).toBeTruthy();
      expect(['none', 'low', 'medium', 'high']).toContain(meta.risk_level);
      expect(typeof meta.side_effects).toBe('boolean');
    }
  });

  it('applies namespace metadata to BUILTIN_TOOLS', () => {
    const fileRead = BUILTIN_TOOLS.find(t => t.name === 'file_read');
    expect(fileRead).toBeDefined();
    expect(fileRead!.namespace).toBe('file');
    expect(fileRead!.family).toBe('file.ops');
    expect(fileRead!.risk_level).toBe('none');
    expect(fileRead!.side_effects).toBe(false);
  });

  it('applies deploy metadata correctly', () => {
    const deployFrontend = BUILTIN_TOOLS.find(t => t.name === 'deploy_frontend');
    expect(deployFrontend).toBeDefined();
    expect(deployFrontend!.namespace).toBe('deploy');
    expect(deployFrontend!.risk_level).toBe('high');
    expect(deployFrontend!.side_effects).toBe(true);
  });
});
