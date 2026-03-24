import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockEnv, MockR2Bucket } from './setup';
import {
  runD1BackupIntegrityCheck,
  runD1BackupInventory,
  runD1DailyBackup,
} from '@/application/services/maintenance/backup-maintenance';

describe('backup-maintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T00:00:00Z'));

    // Mock Cloudflare API export + signed_url download used by runD1DailyBackup().
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
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
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('skips when TAKOS_OFFLOAD is not configured', async () => {
    const env = createMockEnv();

    const backup = await runD1DailyBackup(env as any);
    expect(backup.skipped).toBe(true);

    const inventory = await runD1BackupInventory(env as any);
    expect(inventory.skipped).toBe(true);

    const integrity = await runD1BackupIntegrityCheck(env as any);
    expect(integrity.skipped).toBe(true);
  });

  it('creates a daily D1 backup and skips subsequent runs on the same UTC day', async () => {
    const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    const first = await runD1DailyBackup(env as any, { retentionDays: 35 });
    expect(first.skipped).toBe(false);
    expect(first.key).toMatch(/^backups\/d1\/takos-control-db\/.+\.sql$/);
    expect(typeof first.sha256).toBe('string');

    const second = await runD1DailyBackup(env as any, { retentionDays: 35 });
    expect(second.skipped).toBe(true);
  });

  it('enforces retention by deleting old backups (and keeps newer ones)', async () => {
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
    expect(out.deleted_old_backups).toBeGreaterThanOrEqual(1);

    const listed = await offload.list({ prefix: 'backups/d1/takos-control-db/' });
    const keys = listed.objects.map((o) => o.key);

    expect(keys.some((k) => k.includes('2020-01-01T00-00-00Z.sql'))).toBe(false);
    expect(keys.some((k) => k.includes('2026-02-01T00-00-00Z.sql'))).toBe(true);
    expect(keys.some((k) => k.endsWith('latest.json'))).toBe(true);
  });

  it('writes inventory (counts only .sqlite backups) and is daily-due', async () => {
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
    expect(first.skipped).toBe(false);
    expect(first.objects).toBe(2);
    expect(first.prefix).toBe('backups/d1/takos-control-db/');

    const second = await runD1BackupInventory(env as any);
    expect(second.skipped).toBe(true);
  });

  it('verifies integrity of the latest backup and is weekly-due', async () => {
    const offload = new MockR2Bucket();
    const env = createMockEnv({ TAKOS_OFFLOAD: offload });

    // Create a backup via the job so metadata matches.
    const backup = await runD1DailyBackup(env as any, { force: true });
    expect(backup.skipped).toBe(false);
    expect(backup.key).toBeTruthy();

    const first = await runD1BackupIntegrityCheck(env as any);
    expect(first.skipped).toBe(false);
    expect(first.key).toBe(backup.key);
    expect(first.sha256).toBe(backup.sha256);

    const second = await runD1BackupIntegrityCheck(env as any);
    expect(second.skipped).toBe(true);
  });
});
