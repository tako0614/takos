import {
  getSpaceIdFromPath,
  collectRequestedSpaceIds,
  getScopedSpaceId,
  hasSpaceScopeMismatch,
  hasAnySpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from '../../middleware/space-scope.ts';

import { assertEquals } from 'jsr:@std/assert';

function createContext(overrides: {
  path?: string;
  serviceToken?: { scope_space_id?: string } | null;
  parsedBody?: Record<string, unknown>;
} = {}) {
  const { path = '/repos/ws1/myrepo', serviceToken = null, parsedBody } = overrides;
  return {
    req: {
      path,
      header: () => undefined,
    },
    get(key: string) {
      if (key === 'serviceToken') return serviceToken;
      if (key === 'parsedBody') return parsedBody;
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// getSpaceIdFromPath
// ---------------------------------------------------------------------------


  Deno.test('getSpaceIdFromPath - extracts workspace ID from /repos/:spaceId/:repo path', () => {
  const c = createContext({ path: '/repos/ws1/myrepo' });
    assertEquals(getSpaceIdFromPath(c as any), 'ws1');
})
  Deno.test('getSpaceIdFromPath - extracts workspace ID from deeper paths', () => {
  const c = createContext({ path: '/repos/ws1/myrepo/branches' });
    assertEquals(getSpaceIdFromPath(c as any), 'ws1');
})
  Deno.test('getSpaceIdFromPath - returns null for non-repos path', () => {
  const c = createContext({ path: '/api/health' });
    assertEquals(getSpaceIdFromPath(c as any), null);
})
  Deno.test('getSpaceIdFromPath - returns null for too-short repos path', () => {
  const c = createContext({ path: '/repos/ws1' });
    assertEquals(getSpaceIdFromPath(c as any), null);
})
  Deno.test('getSpaceIdFromPath - returns null for empty repos path', () => {
  const c = createContext({ path: '/repos' });
    assertEquals(getSpaceIdFromPath(c as any), null);
})
// ---------------------------------------------------------------------------
// collectRequestedSpaceIds
// ---------------------------------------------------------------------------


  Deno.test('collectRequestedSpaceIds - returns unique non-empty strings', () => {
  assertEquals(collectRequestedSpaceIds(['ws1', 'ws2', 'ws1']), ['ws1', 'ws2']);
})
  Deno.test('collectRequestedSpaceIds - filters out non-string values', () => {
  assertEquals(collectRequestedSpaceIds([null, undefined, 123, 'ws1']), ['ws1']);
})
  Deno.test('collectRequestedSpaceIds - filters out empty strings', () => {
  assertEquals(collectRequestedSpaceIds(['', 'ws1', '']), ['ws1']);
})
  Deno.test('collectRequestedSpaceIds - returns empty array for all-invalid input', () => {
  assertEquals(collectRequestedSpaceIds([null, undefined, '', 0]), []);
})
// ---------------------------------------------------------------------------
// getScopedSpaceId
// ---------------------------------------------------------------------------


  Deno.test('getScopedSpaceId - returns scope_space_id from service token', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(getScopedSpaceId(c as any), 'ws1');
})
  Deno.test('getScopedSpaceId - returns undefined when no service token', () => {
  const c = createContext({ serviceToken: null });
    assertEquals(getScopedSpaceId(c as any), undefined);
})
  Deno.test('getScopedSpaceId - returns undefined when scope_space_id is not a string', () => {
  const c = createContext({ serviceToken: { scope_space_id: 123 } as any });
    assertEquals(getScopedSpaceId(c as any), undefined);
})
// ---------------------------------------------------------------------------
// hasSpaceScopeMismatch
// ---------------------------------------------------------------------------


  Deno.test('hasSpaceScopeMismatch - returns false when no service token', () => {
  const c = createContext({ serviceToken: null });
    assertEquals(hasSpaceScopeMismatch(c as any, 'ws1'), false);
})
  Deno.test('hasSpaceScopeMismatch - returns false when spaceId matches scope', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasSpaceScopeMismatch(c as any, 'ws1'), false);
})
  Deno.test('hasSpaceScopeMismatch - returns true when spaceId does not match scope', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasSpaceScopeMismatch(c as any, 'ws2'), true);
})
  Deno.test('hasSpaceScopeMismatch - returns false when spaceId is empty/null/undefined', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasSpaceScopeMismatch(c as any, ''), false);
    assertEquals(hasSpaceScopeMismatch(c as any, null), false);
    assertEquals(hasSpaceScopeMismatch(c as any, undefined), false);
})
// ---------------------------------------------------------------------------
// hasAnySpaceScopeMismatch
// ---------------------------------------------------------------------------


  Deno.test('hasAnySpaceScopeMismatch - returns false when all match', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasAnySpaceScopeMismatch(c as any, ['ws1', 'ws1']), false);
})
  Deno.test('hasAnySpaceScopeMismatch - returns true when any mismatch', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasAnySpaceScopeMismatch(c as any, ['ws1', 'ws2']), true);
})
  Deno.test('hasAnySpaceScopeMismatch - returns false for empty array', () => {
  const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    assertEquals(hasAnySpaceScopeMismatch(c as any, []), false);
})
// ---------------------------------------------------------------------------
// SPACE_SCOPE_MISMATCH_ERROR
// ---------------------------------------------------------------------------


  Deno.test('SPACE_SCOPE_MISMATCH_ERROR - is the expected string', () => {
  assertEquals(SPACE_SCOPE_MISMATCH_ERROR, 
      'Token workspace scope does not match requested workspace',
    );
})