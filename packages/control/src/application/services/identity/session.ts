import type { Session, OIDCState } from '../../../shared/types/index.ts';
import type { DurableNamespaceBinding, DurableObjectStubBinding } from '../../../shared/types/bindings.ts';
import { base64UrlEncode } from '../../../shared/utils/index.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';

const SHARD_COUNT = 16;
const MIN_SESSION_ID_LENGTH = 16;
const MAX_SESSION_ID_LENGTH = 128;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_USER_ID_LENGTH = 128;
const SESSION_USER_ID_PATTERN = /^[a-z0-9_-]+$/i;

export function generateSessionId(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer.buffer);
}

export function normalizeSessionId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length < MIN_SESSION_ID_LENGTH || value.length > MAX_SESSION_ID_LENGTH) return null;
  if (!SESSION_ID_PATTERN.test(value)) return null;
  return value;
}

function isValidSessionUserId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (!value) return false;
  if (value.length > MAX_USER_ID_LENGTH) return false;
  return SESSION_USER_ID_PATTERN.test(value);
}

function isValidSessionPayload(raw: unknown): raw is Session {
  if (!raw || typeof raw !== 'object') return false;
  const value = raw as Partial<Session>;
  if (typeof value.id !== 'string' || normalizeSessionId(value.id) !== value.id) return false;
  if (!isValidSessionUserId(value.user_id)) return false;
  if (typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at) || value.expires_at <= 0) return false;
  if (typeof value.created_at !== 'number' || !Number.isFinite(value.created_at) || value.created_at <= 0) return false;
  return true;
}

// FNV-1a hash for shard distribution
function getShardId(key: string): string {
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET_BASIS = 0x811c9dc5;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  const shardIndex = (hash >>> 0) % SHARD_COUNT;
  return shardIndex.toString(16);
}

type SessionDurableObjectStub = DurableObjectStubBinding;
export type SessionStoreBinding = DurableNamespaceBinding;

function getSessionDOForSession(sessionStore: SessionStoreBinding, sessionId: string): SessionDurableObjectStub {
  const namespace = sessionStore as unknown as SessionStoreBinding;
  const shardId = getShardId(sessionId);
  const id = namespace.idFromName(`session-shard-${shardId}`);
  return namespace.get(id);
}

function getSessionDOForOIDCState(sessionStore: SessionStoreBinding, state: string): SessionDurableObjectStub {
  const namespace = sessionStore as unknown as SessionStoreBinding;
  const shardId = getShardId(state);
  const id = namespace.idFromName(`oidc-shard-${shardId}`);
  return namespace.get(id);
}

export async function createSession(sessionStore: SessionStoreBinding, userId: string): Promise<Session> {
  const session: Session = {
    id: generateSessionId(),
    user_id: userId,
    expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    created_at: Date.now(),
  };

  const stub = getSessionDOForSession(sessionStore, session.id);
  try {
    const response = await stub.fetch('http://internal/session/create', {
      method: 'POST',
      body: JSON.stringify({ session }),
    });
    if (!response.ok) {
      throw new Error(`Session DO returned ${response.status}`);
    }
  } catch (err) {
    logError('Failed to create session in DO', err, { module: 'services/identity/session' });
    throw new Error('Session service unavailable');
  }

  return session;
}

export async function getSession(sessionStore: SessionStoreBinding, sessionId: string): Promise<Session | null> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return null;

  const stub = getSessionDOForSession(sessionStore, normalizedSessionId);
  try {
    const response = await stub.fetch('http://internal/session/get', {
      method: 'POST',
      body: JSON.stringify({ sessionId: normalizedSessionId }),
    });
    if (!response.ok) {
      logError(`Session DO returned ${response.status} for getSession`, undefined, { module: 'services/identity/session' });
      return null;
    }
    const payload = await response.json() as { session?: unknown };
    if (!payload.session) return null;
    if (!isValidSessionPayload(payload.session)) {
      logWarn('Discarded malformed session payload from SessionDO', { module: 'services/identity/session' });
      return null;
    }
    return payload.session;
  } catch (err) {
    logError('Failed to get session from DO', err, { module: 'services/identity/session' });
    return null;
  }
}

export async function deleteSession(sessionStore: SessionStoreBinding, sessionId: string): Promise<void> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return;

  const stub = getSessionDOForSession(sessionStore, normalizedSessionId);
  try {
    const response = await stub.fetch('http://internal/session/delete', {
      method: 'POST',
      body: JSON.stringify({ sessionId: normalizedSessionId }),
    });
    if (!response.ok) {
      logError(`Session DO returned ${response.status} for deleteSession`, undefined, { module: 'services/identity/session' });
    }
  } catch (err) {
    logError('Failed to delete session from DO', err, { module: 'services/identity/session' });
  }
}

export async function createOIDCState(sessionStore: SessionStoreBinding, oidcState: OIDCState): Promise<void> {
  const stub = getSessionDOForOIDCState(sessionStore, oidcState.state);
  try {
    const response = await stub.fetch('http://internal/oidc-state/create', {
      method: 'POST',
      body: JSON.stringify({ oidcState }),
    });
    if (!response.ok) {
      throw new Error(`Session DO returned ${response.status}`);
    }
  } catch (err) {
    logError('Failed to create OIDC state in DO', err, { module: 'services/identity/session' });
    throw new Error('Session service unavailable');
  }
}

export async function getOIDCState(sessionStore: SessionStoreBinding, state: string): Promise<OIDCState | null> {
  const stub = getSessionDOForOIDCState(sessionStore, state);
  try {
    const response = await stub.fetch('http://internal/oidc-state/get', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    if (!response.ok) {
      logError(`Session DO returned ${response.status} for getOIDCState`, undefined, { module: 'services/identity/session' });
      return null;
    }
    const { oidcState } = await response.json() as { oidcState: OIDCState | null };
    return oidcState;
  } catch (err) {
    logError('Failed to get OIDC state from DO', err, { module: 'services/identity/session' });
    return null;
  }
}

export async function deleteOIDCState(sessionStore: SessionStoreBinding, state: string): Promise<void> {
  const stub = getSessionDOForOIDCState(sessionStore, state);
  try {
    const response = await stub.fetch('http://internal/oidc-state/delete', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    if (!response.ok) {
      logError(`Session DO returned ${response.status} for deleteOIDCState`, undefined, { module: 'services/identity/session' });
    }
  } catch (err) {
    logError('Failed to delete OIDC state from DO', err, { module: 'services/identity/session' });
  }
}

export const SESSION_COOKIE_NAME = '__Host-tp_session';

export function setSessionCookie(sessionId: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function getSessionIdFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex <= 0) continue;
    const name = cookie.slice(0, separatorIndex);
    const value = cookie.slice(separatorIndex + 1);
    if (name === SESSION_COOKIE_NAME) {
      return normalizeSessionId(value);
    }
  }
  return null;
}
