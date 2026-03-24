import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/config.js', () => ({
  HEARTBEAT_INTERVAL_MS: 120000,
  HEARTBEAT_ASSUMED_INTERVAL_MS: 2 * 60 * 1000,
  PROXY_BASE_URL: undefined,
  SESSION_IDLE_TIMEOUT_MS: 10 * 60 * 1000,
  SESSION_MAX_DURATION_MS: 60 * 60 * 1000,
  SESSION_CLEANUP_INTERVAL_MS: 30 * 1000,
  MAX_SESSIONS_PER_WORKSPACE: 2,
  MAX_TOTAL_SESSIONS: 100000,
}));

import { sessionStore } from '../../../routes/sessions/storage.js';

describe('session owner binding', () => {
  it('rejects session reuse when owner sub does not match', async () => {
    const sessionId = 'a12345678901234b';
    const spaceId = 'ws046owner1';

    try {
      await sessionStore.getSessionDir(sessionId, spaceId, 'owner-a');
      expect(() => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-a')).not.toThrow();
      expect(() => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-b')).toThrow(
        'Session does not belong to the authenticated owner'
      );
    } finally {
      await sessionStore.destroySession(sessionId, spaceId, 'owner-a');
    }
  });

  it('rejects retroactive owner binding when session was created without explicit owner', async () => {
    const sessionId = 'a12345678901234c';
    const spaceId = 'ws046owner2';

    try {
      await sessionStore.getSessionDir(sessionId, spaceId);
      expect(() => sessionStore.getSessionWithValidation(sessionId, spaceId)).not.toThrow();
      expect(() => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-a')).toThrow(
        'Session does not belong to the authenticated owner'
      );
      expect(() => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-b')).toThrow(
        'Session does not belong to the authenticated owner'
      );
    } finally {
      await sessionStore.destroySession(sessionId, spaceId);
    }
  });
});

describe('.takos-session metadata', () => {
  it('stores only session_id and space_id', async () => {
    const sessionId = 'a12345678901234d';
    const spaceId = 'ws046owner3';

    try {
      const workDir = await sessionStore.getSessionDir(sessionId, spaceId, 'owner-a');
      const sessionInfoPath = path.join(workDir, '.takos-session');
      const sessionInfo = JSON.parse(await fs.readFile(sessionInfoPath, 'utf-8')) as Record<string, unknown>;

      expect(sessionInfo).toEqual({
        session_id: sessionId,
        space_id: spaceId,
      });
      expect(sessionInfo).not.toHaveProperty('api_url');
    } finally {
      await sessionStore.destroySession(sessionId, spaceId, 'owner-a');
    }
  });
});
