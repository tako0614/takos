import type { Context } from 'hono';
import { sessionStore } from './storage.js';
import { badRequest } from 'takos-common/middleware/hono';

// ---------------------------------------------------------------------------
// Owner extraction
// ---------------------------------------------------------------------------

export function getOwnerSubFromServiceContext(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload || typeof payload.sub !== 'string') {
    return undefined;
  }
  return payload.sub;
}

export function getSessionOwnerSub(c: Context): string | undefined {
  const payload = c.get('serviceToken');
  return getOwnerSubFromServiceContext(payload);
}

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

interface BodyRecord {
  [key: string]: unknown;
}

export interface SessionSpaceIds {
  sessionId: string;
  spaceId: string;
}

function asBodyRecord(body: unknown): BodyRecord {
  if (body && typeof body === 'object') {
    return body as BodyRecord;
  }
  return {};
}

function readRequiredValue(body: BodyRecord, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseRequiredSessionSpaceIds(body: unknown): SessionSpaceIds | null {
  const record = asBodyRecord(body);
  const sessionId = readRequiredValue(record, 'session_id');
  const spaceId = readRequiredValue(record, 'space_id');
  if (!sessionId || !spaceId) {
    return null;
  }
  return { sessionId, spaceId };
}

export function parseRequiredSpaceId(body: unknown): string | null {
  const record = asBodyRecord(body);
  return readRequiredValue(record, 'space_id');
}

// ---------------------------------------------------------------------------
// Combined session resolution
// ---------------------------------------------------------------------------

export interface ResolvedSession {
  sessionId: string;
  spaceId: string;
  ownerSub: string | undefined;
  workDir: string;
}

/**
 * Parse session/space IDs from request body, resolve owner and working directory.
 * Returns null and sends 400 if IDs are missing (returns a Response that should be returned by the handler).
 */
export async function resolveSessionWorkDir(
  c: Context,
  body: unknown
): Promise<ResolvedSession | { error: Response }> {
  const ids = parseRequiredSessionSpaceIds(body);
  if (!ids) {
    return { error: badRequest(c, 'session_id and space_id are required') };
  }
  const { sessionId, spaceId } = ids;
  const ownerSub = getSessionOwnerSub(c);
  const workDir = await sessionStore.getSessionDir(sessionId, spaceId, ownerSub);
  return { sessionId, spaceId, ownerSub, workDir };
}
