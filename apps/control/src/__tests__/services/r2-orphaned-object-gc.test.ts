import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockR2Bucket, createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import { runR2OrphanedObjectGcBatch } from '@/services/r2/orphaned-object-gc';

type GcEnv = Parameters<typeof runR2OrphanedObjectGcBatch>[0];

describe('r2 orphaned object GC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when TENANT_SOURCE is not configured', async () => {
    const env = createMockEnv({ TENANT_SOURCE: undefined, TAKOS_OFFLOAD: new MockR2Bucket() });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv);
    expect(out.skipped).toBe(true);
    expect(out.reason).toContain('TENANT_SOURCE');
  });

  it('deletes blob objects without DB rows (and not referenced by session_files)', async () => {
    const tenant = new MockR2Bucket();
    const offload = new MockR2Bucket();

    const ws = 'ws_test_123';
    const keepHash = 'a'.repeat(64);
    const referencedHash = 'b'.repeat(64);
    const deleteHash = 'c'.repeat(64);

    await tenant.put(`blobs/${ws}/${keepHash}`, 'keep');
    await tenant.put(`blobs/${ws}/${referencedHash}`, 'referenced');
    await tenant.put(`blobs/${ws}/${deleteHash}`, 'delete');

    // Production code uses drizzle chains:
    //   db.select({hash: blobs.hash}).from(blobs).where(...).all() -> blob hashes
    //   db.selectDistinct({hash: sessionFiles.hash}).from(sessionFiles).innerJoin(...).where(...).all() -> referenced hashes
    //   db.select({id: snapshots.id}).from(snapshots).where(...).all() -> snapshot ids
    const selectAll = vi.fn()
      .mockResolvedValueOnce([{ hash: keepHash }])         // blobs lookup
      .mockResolvedValueOnce([{ hash: referencedHash }]);  // sessionFiles lookup
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.innerJoin = vi.fn().mockReturnValue(c);
      c.all = selectAll;
      return c;
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockImplementation(() => chain()),
      selectDistinct: vi.fn().mockImplementation(() => chain()),
    });

    const env = createMockEnv({ TENANT_SOURCE: tenant, TAKOS_OFFLOAD: offload });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv, {
      dryRun: false,
      minAgeMinutes: 0,
      listLimit: 1000,
      maxDeletes: 1000,
    });

    expect(out.skipped).toBe(false);
    expect(out.deleted.blobs).toBe(1);
    expect(await tenant.get(`blobs/${ws}/${deleteHash}`)).toBe(null);
    expect(await tenant.get(`blobs/${ws}/${keepHash}`)).not.toBe(null);
    expect(await tenant.get(`blobs/${ws}/${referencedHash}`)).not.toBe(null);

    // Cursor state should be written.
    const state = await offload.get('ops/job-state/r2-orphaned-object-gc.json');
    expect(state).not.toBe(null);
  });

  it('deletes tree objects without DB snapshot rows', async () => {
    const tenant = new MockR2Bucket();
    const offload = new MockR2Bucket();

    const ws = 'ws_test_456';
    const keepId = 'snap_keep_123';
    const deleteId = 'snap_delete_123';

    await tenant.put(`trees/${ws}/${keepId}.json.gz`, 'tree');
    await tenant.put(`trees/${ws}/${deleteId}.json.gz`, 'tree');

    // Production code uses:
    //   db.select({hash: blobs.hash}).from(blobs).where(...).all() -> empty (no blobs)
    //   db.select({id: snapshots.id}).from(snapshots).where(...).all() -> snapshot ids
    const selectAll = vi.fn()
      .mockResolvedValueOnce([{ id: keepId }]);  // snapshots lookup
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.innerJoin = vi.fn().mockReturnValue(c);
      c.all = selectAll;
      return c;
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockImplementation(() => chain()),
      selectDistinct: vi.fn().mockImplementation(() => chain()),
    });

    const env = createMockEnv({ TENANT_SOURCE: tenant, TAKOS_OFFLOAD: offload });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv, {
      dryRun: false,
      minAgeMinutes: 0,
      listLimit: 1000,
      maxDeletes: 1000,
    });

    expect(out.deleted.trees).toBe(1);
    expect(await tenant.get(`trees/${ws}/${deleteId}.json.gz`)).toBe(null);
    expect(await tenant.get(`trees/${ws}/${keepId}.json.gz`)).not.toBe(null);
  });
});

