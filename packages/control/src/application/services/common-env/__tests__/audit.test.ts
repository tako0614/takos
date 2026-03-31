import type { Env } from '@/types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import { hashAuditIp, writeCommonEnvAuditLog } from '@/services/common-env/audit';


  Deno.test('hashAuditIp - returns undefined for empty ip', async () => {
  const env = { AUDIT_IP_HASH_KEY: 'secret' } as unknown as Env;
    const result = await hashAuditIp(env, '');
    assertEquals(result, undefined);
})
  Deno.test('hashAuditIp - returns undefined for undefined ip', async () => {
  const env = { AUDIT_IP_HASH_KEY: 'secret' } as unknown as Env;
    const result = await hashAuditIp(env, undefined);
    assertEquals(result, undefined);
})
  Deno.test('hashAuditIp - returns undefined when AUDIT_IP_HASH_KEY is not set', async () => {
  const env = {} as unknown as Env;
    const result = await hashAuditIp(env, '127.0.0.1');
    assertEquals(result, undefined);
})
  Deno.test('hashAuditIp - returns a hex string for valid ip and key', async () => {
  const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result = await hashAuditIp(env, '192.168.1.1');
    assert(result !== undefined);
    assertEquals(typeof result, 'string');
    // HMAC-SHA-256 produces a 64-char hex string
    assertEquals(result!.length, 64);
    assertEquals(/^[0-9a-f]+$/.test(result!), true);
})
  Deno.test('hashAuditIp - produces consistent hashes for the same input', async () => {
  const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result1 = await hashAuditIp(env, '10.0.0.1');
    const result2 = await hashAuditIp(env, '10.0.0.1');
    assertEquals(result1, result2);
})
  Deno.test('hashAuditIp - produces different hashes for different ips', async () => {
  const env = { AUDIT_IP_HASH_KEY: 'test-secret-key' } as unknown as Env;
    const result1 = await hashAuditIp(env, '10.0.0.1');
    const result2 = await hashAuditIp(env, '10.0.0.2');
    assertNotEquals(result1, result2);
})

  Deno.test('writeCommonEnvAuditLog - inserts an audit log entry with the correct fields', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'audit-id-1') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const insertMock = (() => ({
      values: (async () => undefined),
    }));
    mocks.getDb = (() => ({ insert: insertMock })) as any;

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

    assertSpyCalls(insertMock, 1);
    const valuesCall = insertMock.calls[0].value.values;
    assertSpyCalls(valuesCall, 1);
    const values = valuesCall.calls[0][0];
    assertEquals(values.id, 'audit-id-1');
    assertEquals(values.accountId, 'space-1');
    assertEquals(values.actorAccountId, 'user-1');
    assertEquals(values.actorType, 'user');
    assertEquals(values.eventType, 'workspace_env_created');
    assertEquals(values.envName, 'MY_VAR');
    assertEquals(values.serviceId, 'worker-1');
    assertEquals(values.linkSource, 'manual');
    assertEquals(values.requestId, 'req-1');
    assertEquals(values.ipHash, 'hash-1');
    assertEquals(values.userAgent, 'test-agent');
    assertEquals(JSON.parse(values.changeBefore), { exists: false });
    assertEquals(JSON.parse(values.changeAfter), { exists: true });
})
  Deno.test('writeCommonEnvAuditLog - uses system actor defaults when actor is not provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'audit-id-1') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const insertMock = (() => ({
      values: (async () => undefined),
    }));
    mocks.getDb = (() => ({ insert: insertMock })) as any;

    await writeCommonEnvAuditLog({
      db: {} as any,
      spaceId: 'space-1',
      eventType: 'workspace_env_deleted',
      envName: 'MY_VAR',
    });

    const valuesCall = insertMock.calls[0].value.values;
    const values = valuesCall.calls[0][0];
    assertEquals(values.actorType, 'system');
    assertEquals(values.actorAccountId, null);
    assertEquals(values.requestId, null);
    assertEquals(values.ipHash, null);
    assertEquals(values.userAgent, null);
})
  Deno.test('writeCommonEnvAuditLog - handles null/undefined optional fields', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'audit-id-1') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const insertMock = (() => ({
      values: (async () => undefined),
    }));
    mocks.getDb = (() => ({ insert: insertMock })) as any;

    await writeCommonEnvAuditLog({
      db: {} as any,
      spaceId: 'space-1',
      eventType: 'worker_link_added',
      envName: 'MY_VAR',
    });

    const valuesCall = insertMock.calls[0].value.values;
    const values = valuesCall.calls[0][0];
    assertEquals(values.serviceId, null);
    assertEquals(values.linkSource, null);
    assertEquals(JSON.parse(values.changeBefore), {});
    assertEquals(JSON.parse(values.changeAfter), {});
})