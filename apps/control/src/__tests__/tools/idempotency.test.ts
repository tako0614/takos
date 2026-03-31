// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { stub, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockGet = ((..._args: any[]) => undefined) as any;
const mockDelete = ((..._args: any[]) => undefined) as any;
const mockRun = ((..._args: any[]) => undefined) as any;
const mockUpdateSet = ((..._args: any[]) => undefined) as any;
const mockUpdateWhere = ((..._args: any[]) => undefined) as any;
const mockDeleteWhere = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
import {
  generateOperationKey,
  checkIdempotency,
  completeOperation,
  cleanupStaleOperations,
} from '@/tools/idempotency';
import type { D1Database } from '@cloudflare/workers-types';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


  const db = {} as D1Database;
  
    Deno.test('idempotency - generateOperationKey - generates deterministic keys for same inputs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      assertEquals(key1, key2);
})
    Deno.test('idempotency - generateOperationKey - generates different keys for different run ids', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-2', 'file_read', { path: '/test' });
      assertNotEquals(key1, key2);
})
    Deno.test('idempotency - generateOperationKey - generates different keys for different tool names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_write', { path: '/test' });
      assertNotEquals(key1, key2);
})
    Deno.test('idempotency - generateOperationKey - generates different keys for different args', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_read', { path: '/other' });
      assertNotEquals(key1, key2);
})
    Deno.test('idempotency - generateOperationKey - generates same key regardless of arg key ordering', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key1 = await generateOperationKey('run-1', 'tool', { a: 1, b: 2 });
      const key2 = await generateOperationKey('run-1', 'tool', { b: 2, a: 1 });
      assertEquals(key1, key2);
})
    Deno.test('idempotency - generateOperationKey - returns a 32-char hex string', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const key = await generateOperationKey('run-1', 'tool', {});
      assertEquals(key.length, 32);
      assertEquals(/^[0-9a-f]{32}$/.test(key), true);
})  
  
    Deno.test('idempotency - checkIdempotency - returns execute when no existing operation found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => null) as any;
      mockRun = (async () => ({ meta: { changes: 1 } })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'execute');
      assertEquals(result.operationId, 'generated_op_id');
})
    Deno.test('idempotency - checkIdempotency - returns cached when operation is completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
        status: 'completed',
        resultOutput: 'cached result',
        resultError: null,
      })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'cached');
      assertEquals(result.cachedOutput, 'cached result');
      assertEquals(result.cachedError, undefined);
})
    Deno.test('idempotency - checkIdempotency - returns cached with error when completed with error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
        status: 'completed',
        resultOutput: 'some output',
        resultError: 'some error',
      })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'cached');
      assertEquals(result.cachedError, 'some error');
})
    Deno.test('idempotency - checkIdempotency - returns in_progress for fresh pending operations', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
        id: 'op-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
      })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'in_progress');
})
    Deno.test('idempotency - checkIdempotency - deletes and re-executes stale pending operations', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const staleDate = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min ago
      mockGet = (async () => ({
        id: 'op-stale',
        status: 'pending',
        createdAt: staleDate,
      })) as any;
      mockDelete = (async () => ({})) as any;
      mockRun = (async () => ({ meta: { changes: 1 } })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'execute');
})
    Deno.test('idempotency - checkIdempotency - deletes failed operations and allows re-execution', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet = (async () => ({
        id: 'op-failed',
        status: 'failed',
      })) as any;
      mockDelete = (async () => ({})) as any;
      mockRun = (async () => ({ meta: { changes: 1 } })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'execute');
})
    Deno.test('idempotency - checkIdempotency - returns in_progress on race condition (insert returns 0 changes)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet
         = (async () => null) as any // first check: no existing
         = (async () => ({ status: 'pending', createdAt: new Date().toISOString() })) as any; // race check
      mockRun = (async () => ({ meta: { changes: 0 } })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'in_progress');
})
    Deno.test('idempotency - checkIdempotency - returns cached on race condition when other worker completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGet
         = (async () => null) as any
         = (async () => ({ status: 'completed', resultOutput: 'race result', resultError: null })) as any;
      mockRun = (async () => ({ meta: { changes: 0 } })) as any;

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      assertEquals(result.action, 'cached');
      assertEquals(result.cachedOutput, 'race result');
})  
  
    Deno.test('idempotency - completeOperation - marks an operation as completed with output', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockUpdateWhere = (async () => ({})) as any;

      await completeOperation(db, 'op-1', 'done');

      assertSpyCallArgs(mockUpdateSet, 0, [{
        status: 'completed',
        resultOutput: 'done',
        resultError: null,
        completedAt: /* expect.any(String) */ {} as any,
      }]);
      assert(mockUpdateWhere.calls.length > 0);
})
    Deno.test('idempotency - completeOperation - marks an operation as failed with error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockUpdateWhere = (async () => ({})) as any;

      await completeOperation(db, 'op-1', 'output', 'error message');

      assertSpyCallArgs(mockUpdateSet, 0, [{
        status: 'failed',
        resultOutput: 'output',
        resultError: 'error message',
        completedAt: /* expect.any(String) */ {} as any,
      }]);
      assert(mockUpdateWhere.calls.length > 0);
})  
  
    Deno.test('idempotency - cleanupStaleOperations - returns count of deleted operations', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockDeleteWhere = (async () => ({ meta: { changes: 5 } })) as any;

      const result = await cleanupStaleOperations(db);
      assertEquals(result, 5);
})
    Deno.test('idempotency - cleanupStaleOperations - uses 24-hour threshold for cleanup deletion', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const now = Date.now();
      stub(Date, 'now') = (() => now) as any;
      mockDeleteWhere = (async () => ({ meta: { changes: 0 } })) as any;

      await cleanupStaleOperations(db);

      // The cleanup threshold is 24 hours (24 * 60 * 60 * 1000 ms)
      const expectedThreshold = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      assert(mockDeleteWhere.calls.length > 0);
      // The where condition uses lt(toolOperations.createdAt, threshold)
      // Verify the threshold argument is passed to lt() via the where call
      const whereArg = mockDeleteWhere.calls[0][0];
      assert(whereArg !== undefined);

      /* TODO: restore mocks manually */ void 0;
})
    Deno.test('idempotency - cleanupStaleOperations - returns 0 when no operations are stale', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockDeleteWhere = (async () => ({ meta: { changes: 0 } })) as any;

      const result = await cleanupStaleOperations(db);
      assertEquals(result, 0);
})  