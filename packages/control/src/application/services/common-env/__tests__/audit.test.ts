import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import { hashAuditIp, writeCommonEnvAuditLog } from '@/services/common-env/audit';

describe('hashAuditIp', () => {
  it('returns undefined for empty ip', async () => {
    const env = { AUDIT_IP_HASH_KEY: 'secret' } as unknown as Env;
    const result = await hashAuditIp(env, '');
    expect(result).toBeUndefined();
  });

  it('returns undefined for undefined ip', async () => {
    const env = { AUDIT_IP_HASH_KEY: 'secret' } as unknown as Env;
    const result = await hashAuditIp(env, undefined);
    expect(result).toBeUndefined();
  });

  it('returns undefined when AUDIT_IP_HASH_KEY is not set', async () => {
    const env = {} as unknown as Env;
    const result = await hashAuditIp(env, '127.0.0.1');
    expect(result).toBeUndefined();
  });

  it('returns a hex string for valid ip and key', async () => {
    const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result = await hashAuditIp(env, '192.168.1.1');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // HMAC-SHA-256 produces a 64-char hex string
    expect(result!.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(result!)).toBe(true);
  });

  it('produces consistent hashes for the same input', async () => {
    const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result1 = await hashAuditIp(env, '10.0.0.1');
    const result2 = await hashAuditIp(env, '10.0.0.1');
    expect(result1).toBe(result2);
  });

  it('produces different hashes for different ips', async () => {
    const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result1 = await hashAuditIp(env, '10.0.0.1');
    const result2 = await hashAuditIp(env, '10.0.0.2');
    expect(result1).not.toBe(result2);
  });
});

describe('writeCommonEnvAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('audit-id-1');
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('inserts an audit log entry with the correct fields', async () => {
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mocks.getDb.mockReturnValue({ insert: insertMock });

    await writeCommonEnvAuditLog({
      db: {} as any,
      spaceId: 'space-1',
      eventType: 'workspace_env_created',
      envName: 'MY_VAR',
      workerId: 'worker-1',
      linkSource: 'manual',
      changeBefore: { exists: false },
      changeAfter: { exists: true },
      actor: {
        type: 'user',
        userId: 'user-1',
        requestId: 'req-1',
        ipHash: 'hash-1',
        userAgent: 'test-agent',
      },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const valuesCall = insertMock.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledTimes(1);
    const values = valuesCall.mock.calls[0][0];
    expect(values.id).toBe('audit-id-1');
    expect(values.accountId).toBe('space-1');
    expect(values.actorAccountId).toBe('user-1');
    expect(values.actorType).toBe('user');
    expect(values.eventType).toBe('workspace_env_created');
    expect(values.envName).toBe('MY_VAR');
    expect(values.serviceId).toBe('worker-1');
    expect(values.linkSource).toBe('manual');
    expect(values.requestId).toBe('req-1');
    expect(values.ipHash).toBe('hash-1');
    expect(values.userAgent).toBe('test-agent');
    expect(JSON.parse(values.changeBefore)).toEqual({ exists: false });
    expect(JSON.parse(values.changeAfter)).toEqual({ exists: true });
  });

  it('uses system actor defaults when actor is not provided', async () => {
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mocks.getDb.mockReturnValue({ insert: insertMock });

    await writeCommonEnvAuditLog({
      db: {} as any,
      spaceId: 'space-1',
      eventType: 'workspace_env_deleted',
      envName: 'MY_VAR',
    });

    const valuesCall = insertMock.mock.results[0].value.values;
    const values = valuesCall.mock.calls[0][0];
    expect(values.actorType).toBe('system');
    expect(values.actorAccountId).toBeNull();
    expect(values.requestId).toBeNull();
    expect(values.ipHash).toBeNull();
    expect(values.userAgent).toBeNull();
  });

  it('handles null/undefined optional fields', async () => {
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mocks.getDb.mockReturnValue({ insert: insertMock });

    await writeCommonEnvAuditLog({
      db: {} as any,
      spaceId: 'space-1',
      eventType: 'worker_link_added',
      envName: 'MY_VAR',
    });

    const valuesCall = insertMock.mock.results[0].value.values;
    const values = valuesCall.mock.calls[0][0];
    expect(values.serviceId).toBeNull();
    expect(values.linkSource).toBeNull();
    expect(JSON.parse(values.changeBefore)).toEqual({});
    expect(JSON.parse(values.changeAfter)).toEqual({});
  });
});
