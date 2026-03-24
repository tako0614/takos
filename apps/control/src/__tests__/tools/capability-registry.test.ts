import { describe, expect, it, beforeEach } from 'vitest';
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

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it('registers and retrieves descriptors', () => {
    const d = makeDescriptor({ id: 'tool:file_read', name: 'file_read' });
    registry.register(d);

    expect(registry.get('tool:file_read')).toEqual(d);
    expect(registry.size).toBe(1);
  });

  it('registers multiple descriptors', () => {
    const d1 = makeDescriptor({ id: 'tool:a', name: 'a' });
    const d2 = makeDescriptor({ id: 'tool:b', name: 'b' });
    registry.registerAll([d1, d2]);

    expect(registry.size).toBe(2);
    expect(registry.all()).toHaveLength(2);
  });

  it('returns undefined for unknown id', () => {
    expect(registry.get('tool:nonexistent')).toBeUndefined();
  });

  it('filters by kind', () => {
    registry.register(makeDescriptor({ id: 'tool:a', name: 'a', kind: 'tool' }));
    registry.register(makeDescriptor({ id: 'skill:b', name: 'b', kind: 'skill' }));

    expect(registry.byKind('tool')).toHaveLength(1);
    expect(registry.byKind('skill')).toHaveLength(1);
  });

  it('filters by namespace', () => {
    registry.register(makeDescriptor({ id: 'tool:a', name: 'a', namespace: 'file' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', namespace: 'browser' }));

    expect(registry.byNamespace('file')).toHaveLength(1);
    expect(registry.byNamespace('browser')).toHaveLength(1);
  });

  it('filters by family', () => {
    registry.register(makeDescriptor({ id: 'tool:a', name: 'a', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:c', name: 'c', family: 'browser.nav' }));

    expect(registry.byFamily('file.ops')).toHaveLength(2);
    expect(registry.byFamily('browser.nav')).toHaveLength(1);
  });

  it('lists families with counts', () => {
    registry.register(makeDescriptor({ id: 'tool:a', name: 'a', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:c', name: 'c', family: 'browser.nav' }));

    const families = registry.families();
    expect(families).toContainEqual({ family: 'browser.nav', count: 1 });
    expect(families).toContainEqual({ family: 'file.ops', count: 2 });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(makeDescriptor({
        id: 'tool:file_read',
        name: 'file_read',
        summary: 'Read file contents',
        tags: ['file', 'read'],
      }));
      registry.register(makeDescriptor({
        id: 'tool:file_write',
        name: 'file_write',
        summary: 'Write content to a file',
        tags: ['file', 'write'],
      }));
      registry.register(makeDescriptor({
        id: 'tool:browser_open',
        name: 'browser_open',
        namespace: 'browser',
        summary: 'Open a browser session',
        tags: ['browser'],
      }));
    });

    it('finds tools by name', () => {
      const results = registry.search('file_read');
      expect(results[0].name).toBe('file_read');
    });

    it('finds tools by summary text', () => {
      const results = registry.search('browser session');
      expect(results[0].name).toBe('browser_open');
    });

    it('finds tools by tags', () => {
      const results = registry.search('write');
      expect(results.some(d => d.name === 'file_write')).toBe(true);
    });

    it('respects limit', () => {
      const results = registry.search('file', { limit: 1 });
      expect(results).toHaveLength(1);
    });

    it('returns all on empty query with limit', () => {
      const results = registry.search('', { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('returns empty for unmatched query', () => {
      const results = registry.search('zzz_nonexistent');
      expect(results).toHaveLength(0);
    });
  });
});
