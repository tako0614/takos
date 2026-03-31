import { MockR2Bucket } from '../../../../test/integration/setup.ts';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  computeSHA256: (async () => 'sha256-mock'),
  generateId: (() => 'gen-id-1'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  SessionFilesManager,
} from '@/services/sync/session-files';

function makeChain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = (() => c);
  c.where = (() => c);
  c.orderBy = (() => c);
  c.get = (async () => null);
  c.all = (async () => []);
  c.run = (async () => ({ meta: { changes: 1 } }));
  Object.assign(c, overrides);
  return c;
}

function makeDrizzle() {
  return {
    select: () => makeChain(),
    insert: () => {
      const c: Record<string, unknown> = {};
      c.values = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
    update: () => {
      const c: Record<string, unknown> = {};
      c.set = (() => c);
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
    delete: () => {
      const c: Record<string, unknown> = {};
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
  };
}


  const spaceId = 'ws-1';
  const sessionId = 'sess-1';
  let storage: MockR2Bucket;
  
    Deno.test('SessionFilesManager - readFile - returns null when file not found in session or workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  const drizzle = makeDrizzle();
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('nonexistent.ts');
      assertEquals(result, null);
})
    Deno.test('SessionFilesManager - readFile - returns null when session file has delete operation', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  const sessionFileRow = { operation: 'delete', hash: '', size: 0 };
      const selectChain = makeChain({ get: (async () => sessionFileRow) });
      const drizzle = makeDrizzle();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('deleted.ts');
      assertEquals(result, null);
})
    Deno.test('SessionFilesManager - readFile - reads from session blob when session file exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  const sessionFileRow = { operation: 'create', hash: 'hash-abc', size: 5, path: 'src/a.ts' };
      const selectChain = makeChain({ get: (async () => sessionFileRow) });
      const drizzle = makeDrizzle();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      await storage.put(`blobs/${spaceId}/hash-abc`, 'hello');

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('src/a.ts');

      assertNotEquals(result, null);
      assertEquals(result!.content, 'hello');
      assertEquals(result!.hash, 'hash-abc');
})
    Deno.test('SessionFilesManager - readFile - falls back to workspace file when no session file exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let callCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        callCount++;
        if (callCount === 1) {
          // session_files lookup returns null
          return makeChain({ get: (async () => null) });
        }
        // workspace files lookup returns a row
        return makeChain({
          get: (async () => ({ id: 'file-1', path: 'readme.md', sha256: 'ws-hash', size: 10 })),
        });
      };
      mocks.getDb = (() => drizzle) as any;

      await storage.put(`spaces/${spaceId}/files/file-1`, 'workspace content');

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('readme.md');

      assertNotEquals(result, null);
      assertEquals(result!.content, 'workspace content');
})  
  
    Deno.test('SessionFilesManager - writeFile - computes hash and size, writes blob to R2, and inserts session_file', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        selectCount++;
        // All selects return null (no existing session file, no workspace file, no existing)
        return makeChain({ get: (async () => null) });
      };
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.writeFile('src/new.ts', 'new content');

      assertEquals(result.hash, 'sha256-mock');
      assert(result.size > 0);
      assertSpyCallArgs(mocks.computeSHA256, 0, ['new content']);

      // Blob should be stored in R2
      const blob = await storage.get(`blobs/${spaceId}/sha256-mock`);
      assertNotEquals(blob, null);

      // Insert should be called for the session_file record
      assert(drizzle.insert.calls.length > 0);
})
    Deno.test('SessionFilesManager - writeFile - determines operation as update when workspace file exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        selectCount++;
        if (selectCount === 1) return makeChain({ get: (async () => null) }); // no session file
        if (selectCount === 2) return makeChain({ get: (async () => ({ id: 'f1' })) }); // workspace exists
        return makeChain({ get: (async () => null) }); // no existing session file (final check)
      };
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      await mgr.writeFile('existing.ts', 'updated');

      // Insert is called (it's a new session_file for an existing workspace file)
      assert(drizzle.insert.calls.length > 0);
})
    Deno.test('SessionFilesManager - writeFile - updates existing session_file instead of inserting', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        selectCount++;
        if (selectCount === 1) return makeChain({ get: (async () => ({ operation: 'create' })) }); // existing session file
        if (selectCount === 2) return makeChain({ get: (async () => null) }); // no workspace file
        return makeChain({ get: (async () => ({ id: 'existing' })) }); // existing session record found on final check
      };
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      await mgr.writeFile('src/a.ts', 'updated');

      // Update should be called instead of insert
      assert(drizzle.update.calls.length > 0);
})  
  
    Deno.test('SessionFilesManager - deleteFile - returns false when file does not exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  const drizzle = makeDrizzle();
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.deleteFile('nonexistent.ts');
      assertEquals(result, false);
})  
  
    Deno.test('SessionFilesManager - listFiles - combines workspace files with session modifications', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        selectCount++;
        if (selectCount === 1) {
          // workspace files
          return makeChain({
            all: (async () => [
              { path: 'a.ts', size: 10 },
              { path: 'b.ts', size: 20 },
              { path: 'c.ts', size: 30 },
            ]),
          });
        }
        // session files
        return makeChain({
          all: (async () => [
            { path: 'b.ts', size: 25, operation: 'update' }, // updated
            { path: 'c.ts', size: 0, operation: 'delete' },  // deleted
            { path: 'd.ts', size: 15, operation: 'create' }, // new
          ]),
        });
      };
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const files = await mgr.listFiles();

      const fileMap = new Map(files.map(f => [f.path, f.size]));
      assertEquals(fileMap.get('a.ts'), 10);     // unchanged
      assertEquals(fileMap.get('b.ts'), 25);      // updated size
      assertEquals(fileMap.has('c.ts'), false);   // deleted
      assertEquals(fileMap.get('d.ts'), 15);      // new file
})
    Deno.test('SessionFilesManager - listFiles - filters by directory when specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = () => {
        selectCount++;
        if (selectCount === 1) {
          return makeChain({
            all: (async () => [
              { path: 'src/a.ts', size: 10 },
              { path: 'lib/b.ts', size: 20 },
            ]),
          });
        }
        return makeChain({ all: (async () => []) });
      };
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const files = await mgr.listFiles('src');

      assertEquals(files.length, 1);
      assertEquals(files[0].path, 'src/a.ts');
})  
  
    Deno.test('SessionFilesManager - getChanges - returns session file changes in order', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    storage = new MockR2Bucket();
  const selectChain = makeChain({
        all: (async () => [
          { id: 'sf-1', sessionId, path: 'a.ts', hash: 'h1', size: 10, operation: 'create', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'sf-2', sessionId, path: 'b.ts', hash: 'h2', size: 20, operation: 'update', createdAt: '2025-01-01T00:00:01Z' },
        ]),
      });
      const drizzle = makeDrizzle();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const changes = await mgr.getChanges();

      assertEquals(changes.length, 2);
      assertEquals(changes[0].operation, 'create');
      assertEquals(changes[1].operation, 'update');
})  

  Deno.test('SessionFilesManager constructor - creates a SessionFilesManager instance', () => {
  const mgr = new SessionFilesManager({} as never, new MockR2Bucket() as never, 'sp', 'sess');
    assert(mgr instanceof SessionFilesManager);
})