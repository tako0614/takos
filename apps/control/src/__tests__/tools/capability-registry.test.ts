import { CapabilityRegistry } from '@/tools/capability-registry';
import type { CapabilityDescriptor } from '@/tools/capability-types';

import { assertEquals, assert } from 'jsr:@std/assert';

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


  let registry: CapabilityRegistry;
  Deno.test('CapabilityRegistry - registers and retrieves descriptors', () => {
  registry = new CapabilityRegistry();
  const d = makeDescriptor({ id: 'tool:file_read', name: 'file_read' });
    registry.register(d);

    assertEquals(registry.get('tool:file_read'), d);
    assertEquals(registry.size, 1);
})
  Deno.test('CapabilityRegistry - registers multiple descriptors', () => {
  registry = new CapabilityRegistry();
  const d1 = makeDescriptor({ id: 'tool:a', name: 'a' });
    const d2 = makeDescriptor({ id: 'tool:b', name: 'b' });
    registry.registerAll([d1, d2]);

    assertEquals(registry.size, 2);
    assertEquals(registry.all().length, 2);
})
  Deno.test('CapabilityRegistry - returns undefined for unknown id', () => {
  registry = new CapabilityRegistry();
  assertEquals(registry.get('tool:nonexistent'), undefined);
})
  Deno.test('CapabilityRegistry - filters by kind', () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({ id: 'tool:a', name: 'a', kind: 'tool' }));
    registry.register(makeDescriptor({ id: 'skill:b', name: 'b', kind: 'skill' }));

    assertEquals(registry.byKind('tool').length, 1);
    assertEquals(registry.byKind('skill').length, 1);
})
  Deno.test('CapabilityRegistry - filters by namespace', () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({ id: 'tool:a', name: 'a', namespace: 'file' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', namespace: 'browser' }));

    assertEquals(registry.byNamespace('file').length, 1);
    assertEquals(registry.byNamespace('browser').length, 1);
})
  Deno.test('CapabilityRegistry - filters by family', () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({ id: 'tool:a', name: 'a', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:c', name: 'c', family: 'browser.nav' }));

    assertEquals(registry.byFamily('file.ops').length, 2);
    assertEquals(registry.byFamily('browser.nav').length, 1);
})
  Deno.test('CapabilityRegistry - lists families with counts', () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({ id: 'tool:a', name: 'a', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:b', name: 'b', family: 'file.ops' }));
    registry.register(makeDescriptor({ id: 'tool:c', name: 'c', family: 'browser.nav' }));

    const families = registry.families();
    assert(families.some((item: any) => JSON.stringify(item) === JSON.stringify({ family: 'browser.nav', count: 1 })));
    assert(families.some((item: any) => JSON.stringify(item) === JSON.stringify({ family: 'file.ops', count: 2 })));
})
  
    Deno.test('CapabilityRegistry - search - finds tools by name', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('file_read');
      assertEquals(results[0].name, 'file_read');
})
    Deno.test('CapabilityRegistry - search - finds tools by summary text', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('browser session');
      assertEquals(results[0].name, 'browser_open');
})
    Deno.test('CapabilityRegistry - search - finds tools by tags', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('write');
      assertEquals(results.some(d => d.name === 'file_write'), true);
})
    Deno.test('CapabilityRegistry - search - respects limit', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('file', { limit: 1 });
      assertEquals(results.length, 1);
})
    Deno.test('CapabilityRegistry - search - returns all on empty query with limit', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('', { limit: 2 });
      assertEquals(results.length, 2);
})
    Deno.test('CapabilityRegistry - search - returns empty for unmatched query', () => {
  registry = new CapabilityRegistry();
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
  const results = registry.search('zzz_nonexistent');
      assertEquals(results.length, 0);
})  