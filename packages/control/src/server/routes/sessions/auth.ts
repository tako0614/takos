import type { JwtHeartbeatPayload, SessionContext } from './session-mappers.ts';
import { AuthenticationError } from 'takos-common/errors';

export async function authenticateServiceRequest(
  c: SessionContext,
): Promise<Record<string, unknown> | null> {
  // Internal requests from service binding (runtime-host /forward/* proxy)
  const isInternal = c.req.header('X-Takos-Internal') === '1';
  if (isInternal) {
    const sessionId = c.req.header('X-Takos-Session-Id');
    const spaceId = c.req.header('X-Takos-Space-Id');
    if (sessionId) {
      return {
        session_id: sessionId,
        space_id: spaceId,
        sub: 'service',
      };
    }
  }

  return null;
}

export function serviceAuthError(_c: SessionContext): never {
  throw new AuthenticationError('Unauthorized: Invalid or missing service token');
}

export function toJwtHeartbeatPayload(payload: Record<string, unknown>): JwtHeartbeatPayload {
  return {
    session_id: typeof payload.session_id === 'string' ? payload.session_id : undefined,
    space_id: typeof payload.space_id === 'string' ? payload.space_id : undefined,
  };
}
