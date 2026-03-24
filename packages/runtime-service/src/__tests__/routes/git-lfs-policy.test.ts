import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  REPOS_BASE_DIR: '/tmp/test-repos',
}));

import {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
} from '../../routes/git/http.js';

describe('git-lfs policy helpers', () => {
  it('normalizes valid oid and rejects invalid values', () => {
    const upper = 'A'.repeat(64);
    expect(normalizeLfsOid(upper)).toBe('a'.repeat(64));
    expect(normalizeLfsOid('invalid')).toBeNull();
    expect(normalizeLfsOid(undefined)).toBeNull();
  });

  it('parses valid LFS batch request and normalizes object oids', () => {
    const parsed = parseLfsBatchRequest({
      operation: 'upload',
      objects: [{ oid: 'A'.repeat(64), size: 42 }],
    });

    expect(parsed).toEqual({
      operation: 'upload',
      objects: [{ oid: 'a'.repeat(64), size: 42 }],
    });
  });

  it('rejects malformed LFS batch request payloads', () => {
    expect(parseLfsBatchRequest({ operation: 'upload', objects: [{ oid: 'abc', size: 1 }] })).toBeNull();
    expect(parseLfsBatchRequest({ operation: 'download', objects: [{ oid: 'a'.repeat(64), size: -1 }] })).toBeNull();
    expect(parseLfsBatchRequest({ operation: 'download' })).toBeNull();
    expect(parseLfsBatchRequest(null)).toBeNull();
  });

  it('parses content length consistently', () => {
    expect(parseContentLength(undefined)).toBeNull();
    expect(parseContentLength('')).toBeNull();
    expect(parseContentLength('123')).toBe(123);
    expect(Number.isNaN(parseContentLength('12x'))).toBe(true);
  });

  it('builds stable object paths from oid sharding', () => {
    const oid = 'ab'.padEnd(64, 'c');
    expect(getLfsObjectPath('/repo.git', oid)).toBe(
      '/repo.git/lfs/objects/ab/cc/'.concat(oid)
    );
  });

  it('builds upload/download batch responses from existence policy', () => {
    const oid = 'a'.repeat(64);
    const href = `https://example.test/git/ws/repo.git/info/lfs/objects/${oid}`;

    expect(
      buildLfsBatchObjectResponse({
        operation: 'upload',
        oid,
        size: 12,
        exists: true,
        href,
      })
    ).toEqual({ oid, size: 12 });

    expect(
      buildLfsBatchObjectResponse({
        operation: 'upload',
        oid,
        size: 12,
        exists: false,
        href,
      })
    ).toEqual({
      oid,
      size: 12,
      actions: { upload: { href, expires_in: 3600 } },
    });

    expect(
      buildLfsBatchObjectResponse({
        operation: 'download',
        oid,
        size: 12,
        exists: false,
        href,
      })
    ).toEqual({
      oid,
      size: 12,
      error: { code: 404, message: 'Object does not exist' },
    });

    expect(
      buildLfsBatchObjectResponse({
        operation: 'download',
        oid,
        size: 12,
        exists: true,
        href,
      })
    ).toEqual({
      oid,
      size: 12,
      actions: { download: { href, expires_in: 3600 } },
    });
  });
});
