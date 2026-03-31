import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    get: getMock,
  };
  return {
    select: () => chain,
    _: { get: getMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { getSpaceLocale } from '@/services/identity/locale';


  Deno.test('getSpaceLocale - returns "ja" when metadata row contains "ja"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ value: 'ja' })) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, 'ja');
})
  Deno.test('getSpaceLocale - returns "en" when metadata row contains "en"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ value: 'en' })) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, 'en');
})
  Deno.test('getSpaceLocale - returns null when no metadata row exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, null);
})
  Deno.test('getSpaceLocale - returns null when metadata value is not a valid locale', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ value: 'fr' })) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, null);
})
  Deno.test('getSpaceLocale - returns null when metadata value is undefined', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ value: undefined })) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, null);
})
  Deno.test('getSpaceLocale - returns null when metadata value is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({ value: null })) as any;

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    assertEquals(result, null);
})