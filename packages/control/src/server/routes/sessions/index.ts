import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../../shared/types';
import { zValidator } from '../zod-validator';
import {
  discardSession,
  resumeSession,
  startSession,
  stopSession,
} from './lifecycle';
import {
  getSessionHealth,
  heartbeatSession,
} from './heartbeat';
import {
  authenticateServiceRequest,
  serviceAuthError,
  toJwtHeartbeatPayload,
} from './auth';
import type { BaseVariables } from '../route-auth';

const sessions = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
const startSessionSchema = z.object({ repo_id: z.string(), branch: z.string().optional() });
const stopSessionSchema = z.object({ commit_message: z.string().optional() });

sessions.post(
  '/spaces/:spaceId/sessions',
  zValidator('json', startSessionSchema),
  async (c) => startSession(c, c.req.valid('json' as never) as z.infer<typeof startSessionSchema>),
);

sessions.post(
  '/workspaces/:workspaceId/sessions',
  zValidator('json', startSessionSchema),
  async (c) => startSession(c, c.req.valid('json' as never) as z.infer<typeof startSessionSchema>),
);

sessions.post(
  '/sessions/:sessionId/stop',
  zValidator('json', stopSessionSchema),
  async (c) => stopSession(c, c.req.valid('json' as never) as z.infer<typeof stopSessionSchema>),
);

sessions.post('/sessions/:sessionId/resume', resumeSession);
sessions.post('/sessions/:sessionId/discard', discardSession);

sessions.post('/sessions/:sessionId/heartbeat', async (c) => {
  const payload = await authenticateServiceRequest(c);
  if (!payload) {
    return serviceAuthError(c);
  }
  return heartbeatSession(c, toJwtHeartbeatPayload(payload));
});

sessions.get('/sessions/:sessionId/health', getSessionHealth);

export default sessions;
