/**
 * Tests for the d1-raw module: executeD1RawStatement.
 */
import { describe, expect, it, vi } from 'vitest';

import { executeD1RawStatement, type D1RawOptions } from '@/container-hosts/d1-raw';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockStatement(options: {
  rawResult?: unknown[];
  rawColumnResult?: unknown[];
} = {}): any {
  const mock = {
    raw: vi.fn(async (opts?: { columnNames?: boolean }) => {
      if (opts?.columnNames) {
        return options.rawColumnResult ?? [['col1', 'col2'], [1, 'a'], [2, 'b']];
      }
      return options.rawResult ?? [[1, 'a'], [2, 'b']];
    }),
  };
  return mock;
}

// ---------------------------------------------------------------------------
// executeD1RawStatement
// ---------------------------------------------------------------------------

describe('executeD1RawStatement', () => {
  it('calls raw() without options when columnNames is not requested', async () => {
    const stmt = makeMockStatement({ rawResult: [[1], [2], [3]] });

    const result = await executeD1RawStatement(stmt);
    expect(stmt.raw).toHaveBeenCalledWith();
    expect(result).toEqual([[1], [2], [3]]);
  });

  it('calls raw() without options when rawOptions is undefined', async () => {
    const stmt = makeMockStatement();

    const result = await executeD1RawStatement(stmt, undefined);
    expect(stmt.raw).toHaveBeenCalledWith();
  });

  it('calls raw() without options when columnNames is false', async () => {
    const stmt = makeMockStatement();

    const result = await executeD1RawStatement(stmt, { columnNames: false });
    expect(stmt.raw).toHaveBeenCalledWith();
  });

  it('calls raw({ columnNames: true }) when columnNames is true', async () => {
    const stmt = makeMockStatement({
      rawColumnResult: [['id', 'name'], [1, 'test']],
    });

    const result = await executeD1RawStatement(stmt, { columnNames: true });
    expect(stmt.raw).toHaveBeenCalledWith({ columnNames: true });
    expect(result).toEqual([['id', 'name'], [1, 'test']]);
  });

  it('returns empty array when raw returns empty', async () => {
    const stmt = makeMockStatement({ rawResult: [] });

    const result = await executeD1RawStatement(stmt);
    expect(result).toEqual([]);
  });

  it('returns column names as first row when columnNames is true', async () => {
    const stmt = makeMockStatement({
      rawColumnResult: [['a', 'b', 'c']],
    });

    const result = await executeD1RawStatement(stmt, { columnNames: true });
    expect(result[0]).toEqual(['a', 'b', 'c']);
  });

  it('propagates errors from the statement', async () => {
    const stmt = {
      raw: vi.fn().mockRejectedValue(new Error('D1_ERROR: query failed')),
    };

    await expect(executeD1RawStatement(stmt as any)).rejects.toThrow('D1_ERROR: query failed');
  });
});
