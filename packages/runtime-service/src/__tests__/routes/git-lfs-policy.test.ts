// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
import {
  buildLfsBatchObjectResponse,
  getLfsObjectPath,
  normalizeLfsOid,
  parseContentLength,
  parseLfsBatchRequest,
} from '../../routes/git/http.ts';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('git-lfs policy helpers - normalizes valid oid and rejects invalid values', () => {
  const upper = 'A'.repeat(64);
    assertEquals(normalizeLfsOid(upper), 'a'.repeat(64));
    assertEquals(normalizeLfsOid('invalid'), null);
    assertEquals(normalizeLfsOid(undefined), null);
})
  Deno.test('git-lfs policy helpers - parses valid LFS batch request and normalizes object oids', () => {
  const parsed = parseLfsBatchRequest({
      operation: 'upload',
      objects: [{ oid: 'A'.repeat(64), size: 42 }],
    });

    assertEquals(parsed, {
      operation: 'upload',
      objects: [{ oid: 'a'.repeat(64), size: 42 }],
    });
})
  Deno.test('git-lfs policy helpers - rejects malformed LFS batch request payloads', () => {
  assertEquals(parseLfsBatchRequest({ operation: 'upload', objects: [{ oid: 'abc', size: 1 }] }), null);
    assertEquals(parseLfsBatchRequest({ operation: 'download', objects: [{ oid: 'a'.repeat(64), size: -1 }] }), null);
    assertEquals(parseLfsBatchRequest({ operation: 'download' }), null);
    assertEquals(parseLfsBatchRequest(null), null);
})
  Deno.test('git-lfs policy helpers - parses content length consistently', () => {
  assertEquals(parseContentLength(undefined), null);
    assertEquals(parseContentLength(''), null);
    assertEquals(parseContentLength('123'), 123);
    assertEquals(Number.isNaN(parseContentLength('12x')), true);
})
  Deno.test('git-lfs policy helpers - builds stable object paths from oid sharding', () => {
  const oid = 'ab'.padEnd(64, 'c');
    assertEquals(getLfsObjectPath('/repo.git', oid), 
      '/repo.git/lfs/objects/ab/cc/'.concat(oid)
    );
})
  Deno.test('git-lfs policy helpers - builds upload/download batch responses from existence policy', () => {
  const oid = 'a'.repeat(64);
    const href = `https://example.test/git/ws/repo.git/info/lfs/objects/${oid}`;

    assertEquals(
      buildLfsBatchObjectResponse({
        operation: 'upload',
        oid,
        size: 12,
        exists: true,
        href,
      })
    , { oid, size: 12 });

    assertEquals(
      buildLfsBatchObjectResponse({
        operation: 'upload',
        oid,
        size: 12,
        exists: false,
        href,
      })
    , {
      oid,
      size: 12,
      actions: { upload: { href, expires_in: 3600 } },
    });

    assertEquals(
      buildLfsBatchObjectResponse({
        operation: 'download',
        oid,
        size: 12,
        exists: false,
        href,
      })
    , {
      oid,
      size: 12,
      error: { code: 404, message: 'Object does not exist' },
    });

    assertEquals(
      buildLfsBatchObjectResponse({
        operation: 'download',
        oid,
        size: 12,
        exists: true,
        href,
      })
    , {
      oid,
      size: 12,
      actions: { download: { href, expires_in: 3600 } },
    });
})