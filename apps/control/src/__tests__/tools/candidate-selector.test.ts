import { describe, expect, it, beforeEach } from 'vitest';
import { CandidateSelector, DISCOVERY_TOOL_NAMES, type SelectionContext } from '@/tools/candidate-selector';
import { CapabilityRegistry } from '@/tools/capability-registry';
import type { CapabilityDescriptor } from '@/tools/capability-types';

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

describe('CandidateSelector', () => {
  let registry: CapabilityRegistry;
  let selector: CandidateSelector;

  beforeEach(() => {
    registry = new CapabilityRegistry();
    selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  });

  const baseCtx: SelectionContext = {
    capabilities: [],
    userQuery: '',
  };

  it('selects tools up to topK', () => {
    for (let i = 0; i < 10; i++) {
      registry.register(makeDescriptor({
        id: `tool:t${i}`,
        name: `tool_${i}`,
        family: `fam_${i}`,
      }));
    }

    const result = selector.select(registry, baseCtx);
    expect(result.tools).toHaveLength(5);
    expect(result.totalAvailable).toBe(10);
  });

  it('separates tools from skills', () => {
    registry.register(makeDescriptor({ id: 'tool:a', name: 'a', kind: 'tool' }));
    registry.register(makeDescriptor({ id: 'skill:b', name: 'b', kind: 'skill' }));

    const result = selector.select(registry, baseCtx);
    expect(result.tools).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
  });

  it('applies hard filter on policy.selectable', () => {
    registry.register(makeDescriptor({
      id: 'tool:hidden',
      name: 'hidden',
      discoverable: true, selectable: false,
    }));
    registry.register(makeDescriptor({
      id: 'tool:visible',
      name: 'visible',
    }));

    const result = selector.select(registry, baseCtx);
    expect(result.tools.map(d => d.name)).toEqual(['visible']);
  });

  it('filters out high-risk tools for viewers', () => {
    registry.register(makeDescriptor({
      id: 'tool:deploy',
      name: 'deploy',
      risk_level: 'high',
    }));
    registry.register(makeDescriptor({
      id: 'tool:read',
      name: 'read',
      risk_level: 'none',
    }));

    const result = selector.select(registry, { ...baseCtx, role: 'viewer' });
    expect(result.tools.map(d => d.name)).toEqual(['read']);
  });

  it('scores higher for query-matching tools', () => {
    registry.register(makeDescriptor({
      id: 'tool:file_read',
      name: 'file_read',
      tags: ['file'],
      summary: 'Read a file',
      family: 'file.ops',
    }));
    registry.register(makeDescriptor({
      id: 'tool:browser_open',
      name: 'browser_open',
      tags: ['browser'],
      summary: 'Open browser',
      family: 'browser.nav',
    }));

    const result = selector.select(registry, { ...baseCtx, userQuery: 'read a file' });
    expect(result.tools[0].name).toBe('file_read');
  });

  it('applies session state boost', () => {
    registry.register(makeDescriptor({
      id: 'tool:browser_screenshot',
      name: 'browser_screenshot',
      namespace: 'browser',
      family: 'browser.inspect',
    }));
    registry.register(makeDescriptor({
      id: 'tool:web_fetch',
      name: 'web_fetch',
      namespace: 'web',
      family: 'web.fetch',
    }));

    const result = selector.select(registry, {
      ...baseCtx,
      sessionState: { hasActiveContainer: false, hasActiveBrowser: true },
    });
    expect(result.tools[0].name).toBe('browser_screenshot');
  });

  it('boosts recently used tools', () => {
    registry.register(makeDescriptor({
      id: 'tool:a',
      name: 'a',
      family: 'fam_a',
    }));
    registry.register(makeDescriptor({
      id: 'tool:b',
      name: 'b',
      family: 'fam_b',
    }));

    const result = selector.select(registry, {
      ...baseCtx,
      recentToolCalls: ['b'],
    });
    expect(result.tools[0].name).toBe('b');
  });

  it('enforces diversity (MAX_PER_FAMILY)', () => {
    // Create 12 tools in the same family — only 8 should survive diversity filter
    for (let i = 0; i < 12; i++) {
      registry.register(makeDescriptor({
        id: `tool:same_${i}`,
        name: `same_${i}`,
        family: 'same_family',
      }));
    }

    const bigSelector = new CandidateSelector({ topKTools: 15, topKSkills: 0 });
    const result = bigSelector.select(registry, baseCtx);
    expect(result.tools.length).toBeLessThanOrEqual(8);
  });

  it('applies boosted families from skills', () => {
    registry.register(makeDescriptor({
      id: 'tool:container_start',
      name: 'container_start',
      family: 'container.lifecycle',
    }));
    registry.register(makeDescriptor({
      id: 'tool:web_fetch',
      name: 'web_fetch',
      family: 'web.fetch',
    }));

    const result = selector.select(registry, {
      ...baseCtx,
      boostedFamilies: ['container.lifecycle'],
    });
    expect(result.tools[0].name).toBe('container_start');
  });

  it('checks required_capabilities', () => {
    registry.register(makeDescriptor({
      id: 'tool:web_fetch',
      name: 'web_fetch',
      required_capabilities: ['egress.http'],
    }));
    registry.register(makeDescriptor({
      id: 'tool:file_read',
      name: 'file_read',
    }));

    // Without egress.http capability → web_fetch filtered out
    const result = selector.select(registry, {
      ...baseCtx,
      capabilities: [],
    });
    // web_fetch has no required_capabilities check in hard filter (it only checks if ALL are present)
    // Since web_fetch has required_capabilities=['egress.http'] and ctx.capabilities=[], it should be filtered
    expect(result.tools.some(d => d.name === 'web_fetch')).toBe(false);
    expect(result.tools.some(d => d.name === 'file_read')).toBe(true);
  });

  it('excludes discovery tools from scoring', () => {
    for (const name of DISCOVERY_TOOL_NAMES) {
      registry.register(makeDescriptor({
        id: `tool:${name}`,
        name,
        namespace: 'discovery',
        family: 'discovery.search',
      }));
    }
    registry.register(makeDescriptor({ id: 'tool:real', name: 'real_tool' }));

    const result = selector.select(registry, baseCtx);
    // Discovery tools should NOT be in selected tools
    expect(result.tools.every(d => !DISCOVERY_TOOL_NAMES.has(d.name))).toBe(true);
    expect(result.tools.some(d => d.name === 'real_tool')).toBe(true);
  });

  it('handles zero tools after filtering', () => {
    // All tools require a capability the context doesn't have
    registry.register(makeDescriptor({
      id: 'tool:gated',
      name: 'gated',
      required_capabilities: ['special.cap'],
    }));

    const result = selector.select(registry, { ...baseCtx, capabilities: [] });
    expect(result.tools).toHaveLength(0);
    expect(result.totalAvailable).toBe(1);
  });

  it('limits query terms to prevent performance issues', () => {
    registry.register(makeDescriptor({
      id: 'tool:a',
      name: 'a',
      summary: 'A tool',
      tags: ['test'],
    }));

    // 200-word query should not cause issues (capped at 50 terms internally)
    const longQuery = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const result = selector.select(registry, { ...baseCtx, userQuery: longQuery });
    expect(result.tools).toBeDefined();
  });
});
