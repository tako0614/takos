import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// [Deno] vi.mock removed - manually stub imports from '../../../shared/config.ts'
import { sessionStore } from '../../../routes/sessions/storage.ts';


import { assertEquals, assert, assertThrows } from 'jsr:@std/assert';

  Deno.test('session owner binding - rejects session reuse when owner sub does not match', async () => {
  const sessionId = 'a12345678901234b';
    const spaceId = 'ws046owner1';

    try {
      await sessionStore.getSessionDir(sessionId, spaceId, 'owner-a');
      try { () => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-a'); } catch (_e) { throw new Error('Expected no throw'); };
      assertThrows(() => { () => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-b'); }, 
        'Session does not belong to the authenticated owner'
      );
    } finally {
      await sessionStore.destroySession(sessionId, spaceId, 'owner-a');
    }
})
  Deno.test('session owner binding - rejects retroactive owner binding when session was created without explicit owner', async () => {
  const sessionId = 'a12345678901234c';
    const spaceId = 'ws046owner2';

    try {
      await sessionStore.getSessionDir(sessionId, spaceId);
      try { () => sessionStore.getSessionWithValidation(sessionId, spaceId); } catch (_e) { throw new Error('Expected no throw'); };
      assertThrows(() => { () => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-a'); }, 
        'Session does not belong to the authenticated owner'
      );
      assertThrows(() => { () => sessionStore.getSessionWithValidation(sessionId, spaceId, 'owner-b'); }, 
        'Session does not belong to the authenticated owner'
      );
    } finally {
      await sessionStore.destroySession(sessionId, spaceId);
    }
})

  Deno.test('.takos-session metadata - stores only session_id and space_id', async () => {
  const sessionId = 'a12345678901234d';
    const spaceId = 'ws046owner3';

    try {
      const workDir = await sessionStore.getSessionDir(sessionId, spaceId, 'owner-a');
      const sessionInfoPath = path.join(workDir, '.takos-session');
      const sessionInfo = JSON.parse(await fs.readFile(sessionInfoPath, 'utf-8')) as Record<string, unknown>;

      assertEquals(sessionInfo, {
        session_id: sessionId,
        space_id: spaceId,
      });
      assert(!('api_url' in sessionInfo));
    } finally {
      await sessionStore.destroySession(sessionId, spaceId, 'owner-a');
    }
})