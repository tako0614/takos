import { describe, expect, it } from 'vitest';
import {
  parseScopes,
  validateScopes,
  areScopesAllowed,
  hasAccess,
  getScopeSummary,
} from '@/services/oauth/scopes';

describe('parseScopes', () => {
  it('splits a space-separated scope string', () => {
    expect(parseScopes('openid profile email')).toEqual(['openid', 'profile', 'email']);
  });

  it('handles multiple spaces between scopes', () => {
    expect(parseScopes('openid   profile')).toEqual(['openid', 'profile']);
  });

  it('trims and filters empty entries', () => {
    expect(parseScopes('  openid  profile  ')).toEqual(['openid', 'profile']);
  });

  it('returns empty array for empty string', () => {
    expect(parseScopes('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseScopes('   ')).toEqual([]);
  });

  it('handles single scope', () => {
    expect(parseScopes('openid')).toEqual(['openid']);
  });

  it('handles tab-separated scopes', () => {
    expect(parseScopes('openid\tprofile')).toEqual(['openid', 'profile']);
  });
});

describe('validateScopes', () => {
  it('returns valid for known scopes', () => {
    const result = validateScopes(['openid', 'profile', 'email']);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
  });

  it('returns invalid with unknown scopes listed', () => {
    const result = validateScopes(['openid', 'fake_scope', 'another_bad']);
    expect(result.valid).toBe(false);
    expect(result.unknown).toEqual(['fake_scope', 'another_bad']);
  });

  it('returns valid for empty scopes array', () => {
    const result = validateScopes([]);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
  });

  it('recognizes all resource scopes', () => {
    const resourceScopes = [
      'spaces:read', 'spaces:write',
      'files:read', 'files:write',
      'memories:read', 'memories:write',
      'threads:read', 'threads:write',
      'agents:execute',
      'repos:read', 'repos:write',
    ];

    const result = validateScopes(resourceScopes);
    expect(result.valid).toBe(true);
    expect(result.unknown).toEqual([]);
  });
});

describe('areScopesAllowed', () => {
  it('returns true when all requested scopes are in allowed list', () => {
    expect(areScopesAllowed(['openid', 'profile'], ['openid', 'profile', 'email'])).toBe(true);
  });

  it('returns true for empty requested scopes', () => {
    expect(areScopesAllowed([], ['openid'])).toBe(true);
  });

  it('returns false when a requested scope is not allowed', () => {
    expect(areScopesAllowed(['openid', 'spaces:write'], ['openid', 'profile'])).toBe(false);
  });

  it('returns false when allowed list is empty', () => {
    expect(areScopesAllowed(['openid'], [])).toBe(false);
  });
});

describe('hasAccess', () => {
  it('returns true for exact scope match', () => {
    expect(hasAccess(['spaces:read'], 'spaces', 'read')).toBe(true);
    expect(hasAccess(['files:write'], 'files', 'write')).toBe(true);
    expect(hasAccess(['agents:execute'], 'agents', 'execute')).toBe(true);
  });

  it('returns false when scope is not granted', () => {
    expect(hasAccess(['spaces:read'], 'files', 'read')).toBe(false);
    expect(hasAccess([], 'spaces', 'read')).toBe(false);
  });

  it('write scope implies read access', () => {
    expect(hasAccess(['spaces:write'], 'spaces', 'read')).toBe(true);
    expect(hasAccess(['files:write'], 'files', 'read')).toBe(true);
  });

  it('read scope does not imply write access', () => {
    expect(hasAccess(['spaces:read'], 'spaces', 'write')).toBe(false);
  });

  it('write scope does not imply execute access', () => {
    expect(hasAccess(['agents:write'], 'agents', 'execute')).toBe(false);
  });

  it('execute scope does not imply read or write', () => {
    expect(hasAccess(['agents:execute'], 'agents', 'read')).toBe(false);
    expect(hasAccess(['agents:execute'], 'agents', 'write')).toBe(false);
  });
});

describe('getScopeSummary', () => {
  it('separates identity and resource scopes', () => {
    const summary = getScopeSummary(['openid', 'profile', 'spaces:read', 'files:write']);
    expect(summary.identity).toContain('OpenID Connect identity');
    expect(summary.identity).toContain('User profile (name, picture)');
    expect(summary.resources).toContain('Read workspaces');
    expect(summary.resources).toContain('Write files');
  });

  it('returns empty arrays for empty scopes', () => {
    const summary = getScopeSummary([]);
    expect(summary.identity).toEqual([]);
    expect(summary.resources).toEqual([]);
  });

  it('ignores unknown scopes', () => {
    const summary = getScopeSummary(['unknown_scope']);
    expect(summary.identity).toEqual([]);
    expect(summary.resources).toEqual([]);
  });
});
