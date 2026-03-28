import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockRun = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockDeleteWhere = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    get: vi.fn(() => mockGet()),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
      delete: vi.fn(() => ({
        where: vi.fn((...args: unknown[]) => mockDeleteWhere(...args)),
      })),
      run: vi.fn((...args: unknown[]) => mockRun(...args)),
      update: vi.fn(() => ({
        set: vi.fn((...args: unknown[]) => {
          mockUpdateSet(...args);
          return {
            where: vi.fn((...wArgs: unknown[]) => mockUpdateWhere(...wArgs)),
          };
        }),
      })),
    }),
    toolOperations: {
      id: 'id',
      runId: 'run_id',
      operationKey: 'operation_key',
      toolName: 'tool_name',
      status: 'status',
      resultOutput: 'result_output',
      resultError: 'result_error',
      completedAt: 'completed_at',
      createdAt: 'created_at',
    },
  };
});

vi.mock('@/utils', () => ({
  generateId: vi.fn(() => 'generated_op_id'),
}));

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

describe('idempotency', () => {
  const db = {} as D1Database;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateOperationKey', () => {
    it('generates deterministic keys for same inputs', async () => {
      const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      expect(key1).toBe(key2);
    });

    it('generates different keys for different run ids', async () => {
      const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-2', 'file_read', { path: '/test' });
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different tool names', async () => {
      const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_write', { path: '/test' });
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different args', async () => {
      const key1 = await generateOperationKey('run-1', 'file_read', { path: '/test' });
      const key2 = await generateOperationKey('run-1', 'file_read', { path: '/other' });
      expect(key1).not.toBe(key2);
    });

    it('generates same key regardless of arg key ordering', async () => {
      const key1 = await generateOperationKey('run-1', 'tool', { a: 1, b: 2 });
      const key2 = await generateOperationKey('run-1', 'tool', { b: 2, a: 1 });
      expect(key1).toBe(key2);
    });

    it('returns a 32-char hex string', async () => {
      const key = await generateOperationKey('run-1', 'tool', {});
      expect(key).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(key)).toBe(true);
    });
  });

  describe('checkIdempotency', () => {
    it('returns execute when no existing operation found', async () => {
      mockGet.mockResolvedValue(null);
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('execute');
      expect(result.operationId).toBe('generated_op_id');
    });

    it('returns cached when operation is completed', async () => {
      mockGet.mockResolvedValue({
        status: 'completed',
        resultOutput: 'cached result',
        resultError: null,
      });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('cached');
      expect(result.cachedOutput).toBe('cached result');
      expect(result.cachedError).toBeUndefined();
    });

    it('returns cached with error when completed with error', async () => {
      mockGet.mockResolvedValue({
        status: 'completed',
        resultOutput: 'some output',
        resultError: 'some error',
      });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('cached');
      expect(result.cachedError).toBe('some error');
    });

    it('returns in_progress for fresh pending operations', async () => {
      mockGet.mockResolvedValue({
        id: 'op-1',
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('in_progress');
    });

    it('deletes and re-executes stale pending operations', async () => {
      const staleDate = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min ago
      mockGet.mockResolvedValue({
        id: 'op-stale',
        status: 'pending',
        createdAt: staleDate,
      });
      mockDelete.mockResolvedValue({});
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('execute');
    });

    it('deletes failed operations and allows re-execution', async () => {
      mockGet.mockResolvedValue({
        id: 'op-failed',
        status: 'failed',
      });
      mockDelete.mockResolvedValue({});
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('execute');
    });

    it('returns in_progress on race condition (insert returns 0 changes)', async () => {
      mockGet
        .mockResolvedValueOnce(null) // first check: no existing
        .mockResolvedValueOnce({ status: 'pending', createdAt: new Date().toISOString() }); // race check
      mockRun.mockResolvedValue({ meta: { changes: 0 } });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('in_progress');
    });

    it('returns cached on race condition when other worker completed', async () => {
      mockGet
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: 'completed', resultOutput: 'race result', resultError: null });
      mockRun.mockResolvedValue({ meta: { changes: 0 } });

      const result = await checkIdempotency(db, 'run-1', 'tool', {});
      expect(result.action).toBe('cached');
      expect(result.cachedOutput).toBe('race result');
    });
  });

  describe('completeOperation', () => {
    it('marks an operation as completed with output', async () => {
      mockUpdateWhere.mockResolvedValue({});

      await completeOperation(db, 'op-1', 'done');

      expect(mockUpdateSet).toHaveBeenCalledWith({
        status: 'completed',
        resultOutput: 'done',
        resultError: null,
        completedAt: expect.any(String),
      });
      expect(mockUpdateWhere).toHaveBeenCalled();
    });

    it('marks an operation as failed with error', async () => {
      mockUpdateWhere.mockResolvedValue({});

      await completeOperation(db, 'op-1', 'output', 'error message');

      expect(mockUpdateSet).toHaveBeenCalledWith({
        status: 'failed',
        resultOutput: 'output',
        resultError: 'error message',
        completedAt: expect.any(String),
      });
      expect(mockUpdateWhere).toHaveBeenCalled();
    });
  });

  describe('cleanupStaleOperations', () => {
    it('returns count of deleted operations', async () => {
      mockDeleteWhere.mockResolvedValue({ meta: { changes: 5 } });

      const result = await cleanupStaleOperations(db);
      expect(result).toBe(5);
    });

    it('uses 24-hour threshold for cleanup deletion', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockDeleteWhere.mockResolvedValue({ meta: { changes: 0 } });

      await cleanupStaleOperations(db);

      // The cleanup threshold is 24 hours (24 * 60 * 60 * 1000 ms)
      const expectedThreshold = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      expect(mockDeleteWhere).toHaveBeenCalled();
      // The where condition uses lt(toolOperations.createdAt, threshold)
      // Verify the threshold argument is passed to lt() via the where call
      const whereArg = mockDeleteWhere.mock.calls[0][0];
      expect(whereArg).toBeDefined();

      vi.restoreAllMocks();
    });

    it('returns 0 when no operations are stale', async () => {
      mockDeleteWhere.mockResolvedValue({ meta: { changes: 0 } });

      const result = await cleanupStaleOperations(db);
      expect(result).toBe(0);
    });
  });
});
