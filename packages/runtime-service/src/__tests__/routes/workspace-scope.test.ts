import { describe, expect, it } from 'vitest';

import { getWorkspaceIdFromBody } from '../../middleware/space-scope.js';

function createContext(body: unknown): { get: (key: string) => unknown } {
  return {
    get(key: string) {
      if (key === 'parsedBody') return body;
      return undefined;
    },
  };
}

describe('getWorkspaceIdFromBody', () => {
  it('returns spaceId from camelCase body field', () => {
    const c = createContext({ spaceId: 'ws-camel' });
    expect(getWorkspaceIdFromBody(c as any, 'spaceId')).toBe('ws-camel');
  });

  it('returns space_id from snake_case body field', () => {
    const c = createContext({ space_id: 'ws-snake' });
    expect(getWorkspaceIdFromBody(c as any, 'space_id')).toBe('ws-snake');
  });

  it('returns null for missing, empty, and non-string values', () => {
    const invalidBodies: unknown[] = [
      undefined,
      null,
      false,
      0,
      '',
      {},
      { spaceId: '' },
      { spaceId: 123 },
      { space_id: '' },
      { space_id: 123 },
    ];

    for (const body of invalidBodies) {
      const c = createContext(body);
      expect(getWorkspaceIdFromBody(c as any, 'spaceId')).toBeNull();
      expect(getWorkspaceIdFromBody(c as any, 'space_id')).toBeNull();
    }
  });
});
