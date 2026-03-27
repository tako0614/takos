import { describe, expect, it } from 'vitest';
import {
  getWorkspaceIdFromPath,
  collectRequestedWorkspaceIds,
  getScopedWorkspaceId,
  hasWorkspaceScopeMismatch,
  hasAnyWorkspaceScopeMismatch,
  WORKSPACE_SCOPE_MISMATCH_ERROR,
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
// getWorkspaceIdFromPath
// ---------------------------------------------------------------------------

describe('getWorkspaceIdFromPath', () => {
  it('extracts workspace ID from /repos/:spaceId/:repo path', () => {
    const c = createContext({ path: '/repos/ws1/myrepo' });
    expect(getWorkspaceIdFromPath(c as any)).toBe('ws1');
  });

  it('extracts workspace ID from deeper paths', () => {
    const c = createContext({ path: '/repos/ws1/myrepo/branches' });
    expect(getWorkspaceIdFromPath(c as any)).toBe('ws1');
  });

  it('returns null for non-repos path', () => {
    const c = createContext({ path: '/api/health' });
    expect(getWorkspaceIdFromPath(c as any)).toBeNull();
  });

  it('returns null for too-short repos path', () => {
    const c = createContext({ path: '/repos/ws1' });
    expect(getWorkspaceIdFromPath(c as any)).toBeNull();
  });

  it('returns null for empty repos path', () => {
    const c = createContext({ path: '/repos' });
    expect(getWorkspaceIdFromPath(c as any)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectRequestedWorkspaceIds
// ---------------------------------------------------------------------------

describe('collectRequestedWorkspaceIds', () => {
  it('returns unique non-empty strings', () => {
    expect(collectRequestedWorkspaceIds(['ws1', 'ws2', 'ws1'])).toEqual(['ws1', 'ws2']);
  });

  it('filters out non-string values', () => {
    expect(collectRequestedWorkspaceIds([null, undefined, 123, 'ws1'])).toEqual(['ws1']);
  });

  it('filters out empty strings', () => {
    expect(collectRequestedWorkspaceIds(['', 'ws1', ''])).toEqual(['ws1']);
  });

  it('returns empty array for all-invalid input', () => {
    expect(collectRequestedWorkspaceIds([null, undefined, '', 0])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getScopedWorkspaceId
// ---------------------------------------------------------------------------

describe('getScopedWorkspaceId', () => {
  it('returns scope_space_id from service token', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(getScopedWorkspaceId(c as any)).toBe('ws1');
  });

  it('returns undefined when no service token', () => {
    const c = createContext({ serviceToken: null });
    expect(getScopedWorkspaceId(c as any)).toBeUndefined();
  });

  it('returns undefined when scope_space_id is not a string', () => {
    const c = createContext({ serviceToken: { scope_space_id: 123 } as any });
    expect(getScopedWorkspaceId(c as any)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasWorkspaceScopeMismatch
// ---------------------------------------------------------------------------

describe('hasWorkspaceScopeMismatch', () => {
  it('returns false when no service token', () => {
    const c = createContext({ serviceToken: null });
    expect(hasWorkspaceScopeMismatch(c as any, 'ws1')).toBe(false);
  });

  it('returns false when spaceId matches scope', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasWorkspaceScopeMismatch(c as any, 'ws1')).toBe(false);
  });

  it('returns true when spaceId does not match scope', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasWorkspaceScopeMismatch(c as any, 'ws2')).toBe(true);
  });

  it('returns false when spaceId is empty/null/undefined', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasWorkspaceScopeMismatch(c as any, '')).toBe(false);
    expect(hasWorkspaceScopeMismatch(c as any, null)).toBe(false);
    expect(hasWorkspaceScopeMismatch(c as any, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasAnyWorkspaceScopeMismatch
// ---------------------------------------------------------------------------

describe('hasAnyWorkspaceScopeMismatch', () => {
  it('returns false when all match', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnyWorkspaceScopeMismatch(c as any, ['ws1', 'ws1'])).toBe(false);
  });

  it('returns true when any mismatch', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnyWorkspaceScopeMismatch(c as any, ['ws1', 'ws2'])).toBe(true);
  });

  it('returns false for empty array', () => {
    const c = createContext({ serviceToken: { scope_space_id: 'ws1' } });
    expect(hasAnyWorkspaceScopeMismatch(c as any, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WORKSPACE_SCOPE_MISMATCH_ERROR
// ---------------------------------------------------------------------------

describe('WORKSPACE_SCOPE_MISMATCH_ERROR', () => {
  it('is the expected string', () => {
    expect(WORKSPACE_SCOPE_MISMATCH_ERROR).toBe(
      'Token workspace scope does not match requested workspace',
    );
  });
});
