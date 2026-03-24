import { OAUTH_SCOPES } from '../../../shared/types/oauth';

export function parseScopes(scopeString: string): string[] {
  if (!scopeString || !scopeString.trim()) {
    return [];
  }
  return scopeString
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function validateScopes(scopes: string[]): { valid: boolean; unknown: string[] } {
  const unknown = scopes.filter((s) => !OAUTH_SCOPES[s]);
  return {
    valid: unknown.length === 0,
    unknown,
  };
}

export function areScopesAllowed(requested: string[], allowed: string[]): boolean {
  return requested.every((scope) => allowed.includes(scope));
}

export function hasAccess(
  grantedScopes: string[],
  resource: string,
  action: 'read' | 'write' | 'execute'
): boolean {
  const exactScope = `${resource}:${action}`;
  if (grantedScopes.includes(exactScope)) {
    return true;
  }

  if (action === 'read') {
    const writeScope = `${resource}:write`;
    if (grantedScopes.includes(writeScope)) {
      return true;
    }
  }

  return false;
}

export function getScopeSummary(scopes: string[]): { identity: string[]; resources: string[] } {
  const identity: string[] = [];
  const resources: string[] = [];

  for (const scope of scopes) {
    const info = OAUTH_SCOPES[scope];
    if (info) {
      if (info.category === 'identity') {
        identity.push(info.description);
      } else {
        resources.push(info.description);
      }
    }
  }

  return { identity, resources };
}
