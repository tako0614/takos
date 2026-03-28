import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockR2Bucket } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  computeSHA256: vi.fn().mockResolvedValue('sha256-mock'),
  generateId: vi.fn().mockReturnValue('gen-id-1'),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils/hash', () => ({
  computeSHA256: mocks.computeSHA256,
  verifyBundleHash: vi.fn(async () => true),
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
}));

import {
  SessionFilesManager,
} from '@/services/sync/session-files';

function makeChain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.get = vi.fn().mockResolvedValue(null);
  c.all = vi.fn().mockResolvedValue([]);
  c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  Object.assign(c, overrides);
  return c;
}

function makeDrizzle() {
  return {
    select: vi.fn().mockImplementation(() => makeChain()),
    insert: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.values = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
    update: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
    delete: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
  };
}

describe('SessionFilesManager', () => {
  const spaceId = 'ws-1';
  const sessionId = 'sess-1';
  let storage: MockR2Bucket;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MockR2Bucket();
  });

  describe('readFile', () => {
    it('returns null when file not found in session or workspace', async () => {
      const drizzle = makeDrizzle();
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('nonexistent.ts');
      expect(result).toBeNull();
    });

    it('returns null when session file has delete operation', async () => {
      const sessionFileRow = { operation: 'delete', hash: '', size: 0 };
      const selectChain = makeChain({ get: vi.fn().mockResolvedValue(sessionFileRow) });
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('deleted.ts');
      expect(result).toBeNull();
    });

    it('reads from session blob when session file exists', async () => {
      const sessionFileRow = { operation: 'create', hash: 'hash-abc', size: 5, path: 'src/a.ts' };
      const selectChain = makeChain({ get: vi.fn().mockResolvedValue(sessionFileRow) });
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      await storage.put(`blobs/${spaceId}/hash-abc`, 'hello');

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('src/a.ts');

      expect(result).not.toBeNull();
      expect(result!.content).toBe('hello');
      expect(result!.hash).toBe('hash-abc');
    });

    it('falls back to workspace file when no session file exists', async () => {
      let callCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // session_files lookup returns null
          return makeChain({ get: vi.fn().mockResolvedValue(null) });
        }
        // workspace files lookup returns a row
        return makeChain({
          get: vi.fn().mockResolvedValue({ id: 'file-1', path: 'readme.md', sha256: 'ws-hash', size: 10 }),
        });
      });
      mocks.getDb.mockReturnValue(drizzle);

      await storage.put(`spaces/${spaceId}/files/file-1`, 'workspace content');

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.readFile('readme.md');

      expect(result).not.toBeNull();
      expect(result!.content).toBe('workspace content');
    });
  });

  describe('writeFile', () => {
    it('computes hash and size, writes blob to R2, and inserts session_file', async () => {
      let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        selectCount++;
        // All selects return null (no existing session file, no workspace file, no existing)
        return makeChain({ get: vi.fn().mockResolvedValue(null) });
      });
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.writeFile('src/new.ts', 'new content');

      expect(result.hash).toBe('sha256-mock');
      expect(result.size).toBeGreaterThan(0);
      expect(mocks.computeSHA256).toHaveBeenCalledWith('new content');

      // Blob should be stored in R2
      const blob = await storage.get(`blobs/${spaceId}/sha256-mock`);
      expect(blob).not.toBeNull();

      // Insert should be called for the session_file record
      expect(drizzle.insert).toHaveBeenCalled();
    });

    it('determines operation as update when workspace file exists', async () => {
      let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        selectCount++;
        if (selectCount === 1) return makeChain({ get: vi.fn().mockResolvedValue(null) }); // no session file
        if (selectCount === 2) return makeChain({ get: vi.fn().mockResolvedValue({ id: 'f1' }) }); // workspace exists
        return makeChain({ get: vi.fn().mockResolvedValue(null) }); // no existing session file (final check)
      });
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      await mgr.writeFile('existing.ts', 'updated');

      // Insert is called (it's a new session_file for an existing workspace file)
      expect(drizzle.insert).toHaveBeenCalled();
    });

    it('updates existing session_file instead of inserting', async () => {
      let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        selectCount++;
        if (selectCount === 1) return makeChain({ get: vi.fn().mockResolvedValue({ operation: 'create' }) }); // existing session file
        if (selectCount === 2) return makeChain({ get: vi.fn().mockResolvedValue(null) }); // no workspace file
        return makeChain({ get: vi.fn().mockResolvedValue({ id: 'existing' }) }); // existing session record found on final check
      });
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      await mgr.writeFile('src/a.ts', 'updated');

      // Update should be called instead of insert
      expect(drizzle.update).toHaveBeenCalled();
    });
  });

  describe('deleteFile', () => {
    it('returns false when file does not exist', async () => {
      const drizzle = makeDrizzle();
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const result = await mgr.deleteFile('nonexistent.ts');
      expect(result).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('combines workspace files with session modifications', async () => {
      let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        selectCount++;
        if (selectCount === 1) {
          // workspace files
          return makeChain({
            all: vi.fn().mockResolvedValue([
              { path: 'a.ts', size: 10 },
              { path: 'b.ts', size: 20 },
              { path: 'c.ts', size: 30 },
            ]),
          });
        }
        // session files
        return makeChain({
          all: vi.fn().mockResolvedValue([
            { path: 'b.ts', size: 25, operation: 'update' }, // updated
            { path: 'c.ts', size: 0, operation: 'delete' },  // deleted
            { path: 'd.ts', size: 15, operation: 'create' }, // new
          ]),
        });
      });
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const files = await mgr.listFiles();

      const fileMap = new Map(files.map(f => [f.path, f.size]));
      expect(fileMap.get('a.ts')).toBe(10);     // unchanged
      expect(fileMap.get('b.ts')).toBe(25);      // updated size
      expect(fileMap.has('c.ts')).toBe(false);   // deleted
      expect(fileMap.get('d.ts')).toBe(15);      // new file
    });

    it('filters by directory when specified', async () => {
      let selectCount = 0;
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockImplementation(() => {
        selectCount++;
        if (selectCount === 1) {
          return makeChain({
            all: vi.fn().mockResolvedValue([
              { path: 'src/a.ts', size: 10 },
              { path: 'lib/b.ts', size: 20 },
            ]),
          });
        }
        return makeChain({ all: vi.fn().mockResolvedValue([]) });
      });
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const files = await mgr.listFiles('src');

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/a.ts');
    });
  });

  describe('getChanges', () => {
    it('returns session file changes in order', async () => {
      const selectChain = makeChain({
        all: vi.fn().mockResolvedValue([
          { id: 'sf-1', sessionId, path: 'a.ts', hash: 'h1', size: 10, operation: 'create', createdAt: '2025-01-01T00:00:00Z' },
          { id: 'sf-2', sessionId, path: 'b.ts', hash: 'h2', size: 20, operation: 'update', createdAt: '2025-01-01T00:00:01Z' },
        ]),
      });
      const drizzle = makeDrizzle();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const mgr = new SessionFilesManager({} as never, storage as never, spaceId, sessionId);
      const changes = await mgr.getChanges();

      expect(changes).toHaveLength(2);
      expect(changes[0].operation).toBe('create');
      expect(changes[1].operation).toBe('update');
    });
  });
});

describe('SessionFilesManager constructor', () => {
  it('creates a SessionFilesManager instance', () => {
    const mgr = new SessionFilesManager({} as never, new MockR2Bucket() as never, 'sp', 'sess');
    expect(mgr).toBeInstanceOf(SessionFilesManager);
  });
});
