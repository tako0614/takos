import { describe, expect, it } from 'vitest';
import {
  getSpaceIdFromPath,
  collectRequestedSpaceIds,
  getScopedSpaceId,
  hasSpaceScopeMismatch,
  hasAnySpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from '../../middleware/space-scope.js';

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

describe('getSpaceIdFromPath', () => {
  it('extracts workspace ID from /repos/:spaceId/:repo path', () => {
    const c = createContext({ path: '/repos/ws1/myrepo' });
    expect(getSpaceIdFromPath(c as any)).toBe('ws1');
  });

  it('extracts workspace ID from deeper paths', () => {
    const c = createContext({ path: '/repos/ws1/myrepo/branches' });
    expect(getSpaceIdFromPath(c as any)).toBe('ws1');
  });

  it('returns null for non-repos path', () => {
    const c = createContext({ path: '/api/health' });
    expect(getSpaceIdFromPath(c as any)).toBeNull();
  });

  it('returns null for too-short repos path', () => {
    const c = createContext({ path: '/repos/ws1' });
    expect(getSpaceIdFromPath(c as any)).toBeNull();
  });

  it('returns null for empty repos path', () => {
    const c = createContext({ path: '/repos' });
    expect(getSpaceIdFromPath(c as any)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectRequestedSpaceIds
// ---------------------------------------------------------------------------

describe('collectRequestedSpaceIds', () => {
  it('returns unique non-empty strings', () => {
    expect(collectRequestedSpaceIds(['ws1', 'ws2', 'ws1'])).toEqual(['ws1', 'ws2']);
  });

  it('filters out non-string values', () => {
    expect(collectRequestedSpaceIds([null, undefined, 123, 'ws1'])).toEqual(['ws1']);
  });

  it('filters out empty strings', () => {
    expect(collectRequestedSpaceIds(['', 'ws1', ''])).toEqual(['ws1']);
  });

  it('returns empty array for all-invalid input', () => {
    expect(collectRequestedSpaceIds([null, undefined, '', 0])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getScopedSpaceId
// ---------------------------------------------------------------------------

describe('getScopedSpaceId', () => {
  it('returns scope_space_id from service token', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(getScopedSpaceId(c as any)).toBe('ws1');
  });

  it('returns undefined when no service token', () => {
    const c = createContext({ serviceToken: null });
    expect(getScopedSpaceId(c as any)).toBeUndefined();
  });

  it('returns undefined when scope_space_id is not a string', () => {
    const c = createContext({ serviceToken: { scope_space_id: 123 } as any });
    expect(getScopedSpaceId(c as any)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasSpaceScopeMismatch
// ---------------------------------------------------------------------------

describe('hasSpaceScopeMismatch', () => {
  it('returns false when no service token', () => {
    const c = createContext({ serviceToken: null });
    expect(hasSpaceScopeMismatch(c as any, 'ws1')).toBe(false);
  });

  it('returns false when spaceId matches scope', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasSpaceScopeMismatch(c as any, 'ws1')).toBe(false);
  });

  it('returns true when spaceId does not match scope', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasSpaceScopeMismatch(c as any, 'ws2')).toBe(true);
  });

  it('returns false when spaceId is empty/null/undefined', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasSpaceScopeMismatch(c as any, '')).toBe(false);
    expect(hasSpaceScopeMismatch(c as any, null)).toBe(false);
    expect(hasSpaceScopeMismatch(c as any, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasAnySpaceScopeMismatch
// ---------------------------------------------------------------------------

describe('hasAnySpaceScopeMismatch', () => {
  it('returns false when all match', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnySpaceScopeMismatch(c as any, ['ws1', 'ws1'])).toBe(false);
  });

  it('returns true when any mismatch', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnySpaceScopeMismatch(c as any, ['ws1', 'ws2'])).toBe(true);
  });

  it('returns false for empty array', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnySpaceScopeMismatch(c as any, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SPACE_SCOPE_MISMATCH_ERROR
// ---------------------------------------------------------------------------

describe('SPACE_SCOPE_MISMATCH_ERROR', () => {
  it('is the expected string', () => {
    expect(SPACE_SCOPE_MISMATCH_ERROR).toBe(
      'Token workspace scope does not match requested workspace',
    );
  });
});
