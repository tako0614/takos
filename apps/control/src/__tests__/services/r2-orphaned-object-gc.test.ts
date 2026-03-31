import { MockR2Bucket, createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { runR2OrphanedObjectGcBatch } from '@/services/r2/orphaned-object-gc';

type GcEnv = Parameters<typeof runR2OrphanedObjectGcBatch>[0];


  Deno.test('r2 orphaned object GC - skips when TENANT_SOURCE is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = createMockEnv({ TENANT_SOURCE: undefined, TAKOS_OFFLOAD: new MockR2Bucket() });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv);
    assertEquals(out.skipped, true);
    assertStringIncludes(out.reason, 'TENANT_SOURCE');
})
  Deno.test('r2 orphaned object GC - deletes blob objects without DB rows (and not referenced by session_files)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    const selectAll = ((..._args: any[]) => undefined) as any
       = (async () => [{ hash: keepHash }]) as any         // blobs lookup
       = (async () => [{ hash: referencedHash }]) as any;  // sessionFiles lookup
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = (() => c);
      c.where = (() => c);
      c.innerJoin = (() => c);
      c.all = selectAll;
      return c;
    };
    mocks.getDb = (() => ({
      select: () => chain(),
      selectDistinct: () => chain(),
    })) as any;

    const env = createMockEnv({ TENANT_SOURCE: tenant, TAKOS_OFFLOAD: offload });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv, {
      dryRun: false,
      minAgeMinutes: 0,
      listLimit: 1000,
      maxDeletes: 1000,
    });

    assertEquals(out.skipped, false);
    assertEquals(out.deleted.blobs, 1);
    assertEquals(await tenant.get(`blobs/${ws}/${deleteHash}`), null);
    assertNotEquals(await tenant.get(`blobs/${ws}/${keepHash}`), null);
    assertNotEquals(await tenant.get(`blobs/${ws}/${referencedHash}`), null);

    // Cursor state should be written.
    const state = await offload.get('ops/job-state/r2-orphaned-object-gc.json');
    assertNotEquals(state, null);
})
  Deno.test('r2 orphaned object GC - deletes tree objects without DB snapshot rows', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    const selectAll = ((..._args: any[]) => undefined) as any
       = (async () => [{ id: keepId }]) as any;  // snapshots lookup
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = (() => c);
      c.where = (() => c);
      c.innerJoin = (() => c);
      c.all = selectAll;
      return c;
    };
    mocks.getDb = (() => ({
      select: () => chain(),
      selectDistinct: () => chain(),
    })) as any;

    const env = createMockEnv({ TENANT_SOURCE: tenant, TAKOS_OFFLOAD: offload });
    const out = await runR2OrphanedObjectGcBatch(env as unknown as GcEnv, {
      dryRun: false,
      minAgeMinutes: 0,
      listLimit: 1000,
      maxDeletes: 1000,
    });

    assertEquals(out.deleted.trees, 1);
    assertEquals(await tenant.get(`trees/${ws}/${deleteId}.json.gz`), null);
    assertNotEquals(await tenant.get(`trees/${ws}/${keepId}.json.gz`), null);
})
