import { createMockEnv, MockR2Bucket } from './setup';
import {
  runD1BackupIntegrityCheck,
  runD1BackupInventory,
  runD1DailyBackup,
} from '@/application/services/maintenance/backup-maintenance';


    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
import { assertEquals, assert } from 'jsr:@std/assert';
import { FakeTime } from 'jsr:@std/testing/time';

    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  });

  
  Deno.test('backup-maintenance - skips when TAKOS_OFFLOAD is not configured', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const env = createMockEnv();

    const backup = await runD1DailyBackup(env as any);
    assertEquals(backup.skipped, true);

    const inventory = await runD1BackupInventory(env as any);
    assertEquals(inventory.skipped, true);

    const integrity = await runD1BackupIntegrityCheck(env as any);
    assertEquals(integrity.skipped, true);
})
  Deno.test('backup-maintenance - creates a daily D1 backup and skips subsequent runs on the same UTC day', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    const first = await runD1DailyBackup(env as any, { retentionDays: 35 });
    assertEquals(first.skipped, false);
    assert(/^backups\/d1\/takos-control-db\/.+\.sql$/.test(first.key));
    assertEquals(typeof first.sha256, 'string');

    const second = await runD1DailyBackup(env as any, { retentionDays: 35 });
    assertEquals(second.skipped, true);
})
  Deno.test('backup-maintenance - skips cleanly when the local database adapter does not support DB.dump()', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const offload = new MockR2Bucket();
    const env = createMockEnv({
      TAKOS_OFFLOAD: offload,
      CF_ACCOUNT_ID: undefined,
      CF_API_TOKEN: undefined,
      DB: {
        dump: async () => {
          throw new Error('DB.dump() is not implemented for the local Postgres adapter');
        },
      },
    });

    const result = await runD1DailyBackup(env as any, { retentionDays: 35, force: true });

    assertEquals(result, {
      skipped: true,
      reason: 'DB.dump() is not supported by this local database adapter; configure Cloudflare D1 export credentials instead.',
    });
})
  Deno.test('backup-maintenance - enforces retention by deleting old backups (and keeps newer ones)', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Older than retention (cutoff is 2026-01-11 for 35 days from 2026-02-15).
    await offload.put('backups/d1/takos-control-db/2020-01-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'x' },
    });
    // Within retention.
    await offload.put('backups/d1/takos-control-db/2026-02-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'y' },
    });

    const out = await runD1DailyBackup(env as any, { retentionDays: 35, force: true });
    assert(out.deleted_old_backups >= 1);

    const listed = await offload.list({ prefix: 'backups/d1/takos-control-db/' });
    const keys = listed.objects.map((o) => o.key);

    assertEquals(keys.some((k) => k.includes('2020-01-01T00-00-00Z.sql')), false);
    assertEquals(keys.some((k) => k.includes('2026-02-01T00-00-00Z.sql')), true);
    assertEquals(keys.some((k) => k.endsWith('latest.json')), true);
})
  Deno.test('backup-maintenance - writes inventory (counts only .sqlite backups) and is daily-due', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Seed two backups.
    await offload.put('backups/d1/takos-control-db/2026-02-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'a' },
    });
    await offload.put('backups/d1/takos-control-db/2026-02-02T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'b' },
    });
    await offload.put('backups/d1/takos-control-db/latest.json', JSON.stringify({ key: 'x' }));

    const first = await runD1BackupInventory(env as any);
    assertEquals(first.skipped, false);
    assertEquals(first.objects, 2);
    assertEquals(first.prefix, 'backups/d1/takos-control-db/');

    const second = await runD1BackupInventory(env as any);
    assertEquals(second.skipped, true);
})
  Deno.test('backup-maintenance - verifies integrity of the latest backup and is weekly-due', async () => {
  new FakeTime();
    /* TODO: fakeTime = new FakeTime(new Date('2026-02-15T00:00:00Z') */ void 0);

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    (globalThis as any).fetch = async (input: any, init?: any => {
      const url = typeof input === 'string' ? input : String(input?.url || input);
      const method = String(init?.method || 'GET').toUpperCase();

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database') && !url.includes('/export') && method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          result: [{ uuid: 'db-uuid', name: 'takos-control-db' }],
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url.includes('/client/v4/accounts/') && url.includes('/d1/database/') && url.endsWith('/export') && method === 'POST') {
        return new Response(JSON.stringify({
          success: true,
          result: {
            at_bookmark: 'bookmark-1',
            status: 'complete',
            result: { filename: 'takos-control-db.sql', signed_url: 'https://signed.example/export.sql' },
          },
        }), { headers: { 'content-type': 'application/json' } });
      }

      if (url === 'https://signed.example/export.sql' && method === 'GET') {
        return new Response('CREATE TABLE t(x);', { headers: { 'content-type': 'application/sql; charset=utf-8' } });
      }

      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    });
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Create a backup via the job so metadata matches.
    const backup = await runD1DailyBackup(env as any, { force: true });
    assertEquals(backup.skipped, false);
    assert(backup.key);

    const first = await runD1BackupIntegrityCheck(env as any);
    assertEquals(first.skipped, false);
    assertEquals(first.key, backup.key);
    assertEquals(first.sha256, backup.sha256);

    const second = await runD1BackupIntegrityCheck(env as any);
    assertEquals(second.skipped, true);
})
  
  Deno.test('skips when TAKOS_OFFLOAD is not configured', async () => {
  const env = createMockEnv();

    const backup = await runD1DailyBackup(env as any);
    assertEquals(backup.skipped, true);

    const inventory = await runD1BackupInventory(env as any);
    assertEquals(inventory.skipped, true);

    const integrity = await runD1BackupIntegrityCheck(env as any);
    assertEquals(integrity.skipped, true);
})
  Deno.test('creates a daily D1 backup and skips subsequent runs on the same UTC day', async () => {
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    const first = await runD1DailyBackup(env as any, { retentionDays: 35 });
    assertEquals(first.skipped, false);
    assert(/^backups\/d1\/takos-control-db\/.+\.sql$/.test(first.key));
    assertEquals(typeof first.sha256, 'string');

    const second = await runD1DailyBackup(env as any, { retentionDays: 35 });
    assertEquals(second.skipped, true);
})
  Deno.test('skips cleanly when the local database adapter does not support DB.dump()', async () => {
  const offload = new MockR2Bucket();
    const env = createMockEnv({
      TAKOS_OFFLOAD: offload,
      CF_ACCOUNT_ID: undefined,
      CF_API_TOKEN: undefined,
      DB: {
        dump: async () => {
          throw new Error('DB.dump() is not implemented for the local Postgres adapter');
        },
      },
    });

    const result = await runD1DailyBackup(env as any, { retentionDays: 35, force: true });

    assertEquals(result, {
      skipped: true,
      reason: 'DB.dump() is not supported by this local database adapter; configure Cloudflare D1 export credentials instead.',
    });
})
  Deno.test('enforces retention by deleting old backups (and keeps newer ones)', async () => {
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Older than retention (cutoff is 2026-01-11 for 35 days from 2026-02-15).
    await offload.put('backups/d1/takos-control-db/2020-01-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'x' },
    });
    // Within retention.
    await offload.put('backups/d1/takos-control-db/2026-02-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'y' },
    });

    const out = await runD1DailyBackup(env as any, { retentionDays: 35, force: true });
    assert(out.deleted_old_backups >= 1);

    const listed = await offload.list({ prefix: 'backups/d1/takos-control-db/' });
    const keys = listed.objects.map((o) => o.key);

    assertEquals(keys.some((k) => k.includes('2020-01-01T00-00-00Z.sql')), false);
    assertEquals(keys.some((k) => k.includes('2026-02-01T00-00-00Z.sql')), true);
    assertEquals(keys.some((k) => k.endsWith('latest.json')), true);
})
  Deno.test('writes inventory (counts only .sqlite backups) and is daily-due', async () => {
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Seed two backups.
    await offload.put('backups/d1/takos-control-db/2026-02-01T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'a' },
    });
    await offload.put('backups/d1/takos-control-db/2026-02-02T00-00-00Z.sql', new ArrayBuffer(1), {
      customMetadata: { sha256: 'b' },
    });
    await offload.put('backups/d1/takos-control-db/latest.json', JSON.stringify({ key: 'x' }));

    const first = await runD1BackupInventory(env as any);
    assertEquals(first.skipped, false);
    assertEquals(first.objects, 2);
    assertEquals(first.prefix, 'backups/d1/takos-control-db/');

    const second = await runD1BackupInventory(env as any);
    assertEquals(second.skipped, true);
})
  Deno.test('verifies integrity of the latest backup and is weekly-due', async () => {
  const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Create a backup via the job so metadata matches.
    const backup = await runD1DailyBackup(env as any, { force: true });
    assertEquals(backup.skipped, false);
    assert(backup.key);

    const first = await runD1BackupIntegrityCheck(env as any);
    assertEquals(first.skipped, false);
    assertEquals(first.key, backup.key);
    assertEquals(first.sha256, backup.sha256);

    const second = await runD1BackupIntegrityCheck(env as any);
    assertEquals(second.skipped, true);
})});
