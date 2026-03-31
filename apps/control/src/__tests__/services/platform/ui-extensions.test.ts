import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  listUIExtensions,
  getUIExtensionByPath,
  getUIExtensionBundle,
  getUISidebarItems,
  isUIExtensionPath,
  getUIExtensionPaths,
} from '@/services/platform/ui-extensions';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
    _: { get: getMock, all: allMock },
  };
}

const makeExtRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ext-1',
  accountId: 'ws-1',
  path: '/custom-panel',
  label: 'Custom Panel',
  icon: 'star',
  bundleR2Key: 'ui-ext/ws-1/ext-1.js',
  sidebarJson: JSON.stringify({ label: 'Panel', icon: 'star', path: '/custom-panel' }),
  bundleDeploymentId: 'bd-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});


  Deno.test('listUIExtensions - returns empty array when no extensions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listUIExtensions({} as D1Database, 'ws-1');
    assertEquals(result, []);
})
  Deno.test('listUIExtensions - maps extension rows correctly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeExtRow()]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listUIExtensions({} as D1Database, 'ws-1');
    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'ext-1');
    assertEquals(result[0].path, '/custom-panel');
    assertEquals(result[0].label, 'Custom Panel');
    assert(result[0].sidebar !== undefined);
    assertEquals(result[0].sidebar!.label, 'Panel');
    assertEquals(result[0].bundleDeploymentId, 'bd-1');
})

  Deno.test('getUIExtensionByPath - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/nonexistent');
    assertEquals(result, null);
})
  Deno.test('getUIExtensionByPath - returns extension when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeExtRow()) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/custom-panel');
    assertNotEquals(result, null);
    assertEquals(result!.path, '/custom-panel');
})
  Deno.test('getUIExtensionByPath - handles extension without sidebar JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeExtRow({ sidebarJson: null })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/custom-panel');
    assertNotEquals(result, null);
    assertEquals(result!.sidebar, undefined);
})

  Deno.test('getUIExtensionBundle - returns null when extension not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const storage = {} as R2Bucket;
    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/nonexistent');
    assertEquals(result, null);
})
  Deno.test('getUIExtensionBundle - returns null when R2 object not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeExtRow()) as any;
    mocks.getDb = (() => drizzle) as any;

    const storage = {
      get: (async () => null),
    } as unknown as R2Bucket;

    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/custom-panel');
    assertEquals(result, null);
})
  Deno.test('getUIExtensionBundle - returns content and content type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => makeExtRow()) as any;
    mocks.getDb = (() => drizzle) as any;

    const content = new ArrayBuffer(10);
    const storage = {
      get: (async () => ({
        arrayBuffer: (async () => content),
        httpMetadata: { contentType: 'application/javascript' },
      })),
    } as unknown as R2Bucket;

    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/custom-panel');
    assertNotEquals(result, null);
    assertEquals(result!.contentType, 'application/javascript');
})

  Deno.test('getUISidebarItems - returns empty array when no sidebar extensions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUISidebarItems({} as D1Database, 'ws-1');
    assertEquals(result, []);
})
  Deno.test('getUISidebarItems - filters out invalid sidebar JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      makeExtRow(),
      makeExtRow({ id: 'ext-2', sidebarJson: '{"invalid": true}' }),
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUISidebarItems({} as D1Database, 'ws-1');
    // The first has valid sidebar, the second is missing label/icon
    assertEquals(result.length, 1);
    assertEquals(result[0].extensionId, 'ext-1');
})

  Deno.test('isUIExtensionPath - returns true when extension exists at path', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ count: 1 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await isUIExtensionPath({} as D1Database, 'ws-1', '/custom-panel');
    assertEquals(result, true);
})
  Deno.test('isUIExtensionPath - returns false when no extension at path', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ count: 0 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await isUIExtensionPath({} as D1Database, 'ws-1', '/nonexistent');
    assertEquals(result, false);
})

  Deno.test('getUIExtensionPaths - returns all registered paths', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [{ path: '/panel-a' }, { path: '/panel-b' }]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getUIExtensionPaths({} as D1Database, 'ws-1');
    assertEquals(result, ['/panel-a', '/panel-b']);
})