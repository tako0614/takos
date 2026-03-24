/**
 * Tests for cf-types.ts
 *
 * This module defines structural interfaces for Cloudflare-shaped bindings
 * used in Node.js environments. These tests verify the type contracts are
 * sound by creating conforming objects and verifying their shapes.
 */
import { describe, expect, it } from 'vitest';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  R2Bucket,
  R2Object,
  R2ObjectMetadata,
  R2Objects,
  DurableObjectId,
  DurableObjectStub,
  DurableObjectNamespace,
  VectorizeIndex,
  VectorizeVector,
  VectorizeMatch,
  VectorizeQueryResult,
  Ai,
  Queue,
  Fetcher,
  KVNamespace,
} from '../cf-types.js';

describe('cf-types structural contracts', () => {
  describe('D1Database', () => {
    it('accepts a conforming D1Database implementation', () => {
      const db: D1Database = {
        prepare: (query: string) => ({
          bind: (..._values: unknown[]) => db.prepare(query),
          first: async () => null,
          run: async () => ({ results: [], success: true, meta: {} }),
          all: async () => ({ results: [], success: true, meta: {} }),
          raw: async () => [] as any,
        }),
        batch: async () => [],
        exec: async () => ({ count: 0, duration: 0 }),
      };
      expect(db.prepare).toBeDefined();
      expect(db.batch).toBeDefined();
      expect(db.exec).toBeDefined();
    });
  });

  describe('D1Result', () => {
    it('has the correct shape', () => {
      const result: D1Result = {
        results: [{ id: 1, name: 'test' }],
        success: true,
        meta: { duration: 1.5 },
      };
      expect(result.results).toHaveLength(1);
      expect(result.success).toBe(true);
    });
  });

  describe('D1ExecResult', () => {
    it('has count and duration', () => {
      const result: D1ExecResult = { count: 5, duration: 10.2 };
      expect(result.count).toBe(5);
      expect(result.duration).toBe(10.2);
    });
  });

  describe('R2ObjectMetadata', () => {
    it('accepts a conforming metadata object', () => {
      const meta: R2ObjectMetadata = {
        key: 'files/test.txt',
        size: 1024,
        etag: '"abc123"',
        httpEtag: '"abc123"',
        checksums: { md5: 'abc' },
        uploaded: new Date(),
      };
      expect(meta.key).toBe('files/test.txt');
      expect(meta.size).toBe(1024);
    });
  });

  describe('R2Objects', () => {
    it('has correct list response shape', () => {
      const result: R2Objects = {
        objects: [],
        truncated: false,
        delimitedPrefixes: [],
      };
      expect(result.objects).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it('supports cursor for pagination', () => {
      const result: R2Objects = {
        objects: [],
        truncated: true,
        cursor: 'next-cursor',
        delimitedPrefixes: ['prefix/'],
      };
      expect(result.cursor).toBe('next-cursor');
    });
  });

  describe('DurableObjectId', () => {
    it('has toString and equals', () => {
      const id: DurableObjectId = {
        toString: () => 'do-id-123',
        equals: (other) => other.toString() === 'do-id-123',
      };
      expect(id.toString()).toBe('do-id-123');
      expect(id.equals(id)).toBe(true);
    });

    it('supports optional name', () => {
      const id: DurableObjectId = {
        toString: () => 'do-named',
        equals: () => true,
        name: 'my-do',
      };
      expect(id.name).toBe('my-do');
    });
  });

  describe('VectorizeVector', () => {
    it('has required id and optional fields', () => {
      const vec: VectorizeVector = {
        id: 'vec-1',
        values: [0.1, 0.2, 0.3],
        metadata: { label: 'test' },
        namespace: 'default',
      };
      expect(vec.id).toBe('vec-1');
      expect(vec.values).toHaveLength(3);
    });

    it('works with minimal fields', () => {
      const vec: VectorizeVector = { id: 'vec-2' };
      expect(vec.id).toBe('vec-2');
      expect(vec.values).toBeUndefined();
    });
  });

  describe('VectorizeMatch', () => {
    it('has required id and score', () => {
      const match: VectorizeMatch = {
        id: 'match-1',
        score: 0.95,
      };
      expect(match.id).toBe('match-1');
      expect(match.score).toBe(0.95);
    });
  });

  describe('VectorizeQueryResult', () => {
    it('has matches and count', () => {
      const result: VectorizeQueryResult = {
        matches: [{ id: 'm-1', score: 0.9 }],
        count: 1,
      };
      expect(result.matches).toHaveLength(1);
      expect(result.count).toBe(1);
    });
  });

  describe('QueueSendOptions', () => {
    it('supports contentType and delaySeconds', () => {
      const opts: import('../cf-types.js').QueueSendOptions = {
        contentType: 'json',
        delaySeconds: 30,
      };
      expect(opts.contentType).toBe('json');
      expect(opts.delaySeconds).toBe(30);
    });
  });
});
