import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLogger } from 'takos-common/logger';
import {
  HEARTBEAT_ASSUMED_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MAX_DURATION_MS,
  SESSION_CLEANUP_INTERVAL_MS,
  MAX_SESSIONS_PER_WORKSPACE,
  MAX_TOTAL_SESSIONS,
} from '../../shared/config.ts';
import { isValidSessionId, validateSpaceId } from '../../runtime/validation.ts';
import { OwnerBindingError } from '../../shared/errors.ts';
import { startHeartbeat } from '../../runtime/heartbeat.ts';

const logger = createLogger({ service: 'takos-runtime' });

// ===========================================================================
// Session store
// ===========================================================================

class SessionMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

export interface Session {
  id: string;
  spaceId: string;
  ownerSub?: string;
  proxyToken?: string;
  workDir: string;
  createdAt: number;
  lastAccessedAt: number;
  heartbeatTimer?: ReturnType<typeof setInterval> | null;
}

type SessionExpiryReason = 'inactive_timeout' | 'max_duration';
type SessionStopReason = SessionExpiryReason | 'manual';

const MAX_OWNER_SUB_LENGTH = 256;

if (HEARTBEAT_INTERVAL_MS > HEARTBEAT_ASSUMED_INTERVAL_MS) {
  logger.warn('Heartbeat interval exceeds lifecycle assumption', {
    configuredMs: HEARTBEAT_INTERVAL_MS,
    assumedMaxMs: HEARTBEAT_ASSUMED_INTERVAL_MS,
  });
}

function normalizeOwnerSub(ownerSub?: string): string | undefined {
  if (typeof ownerSub !== 'string') return undefined;
  const trimmed = ownerSub.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OWNER_SUB_LENGTH) return undefined;
  return trimmed;
}

function enforceSessionOwnerBinding(session: Session, ownerSub?: string): void {
  const normalizedOwnerSub = normalizeOwnerSub(ownerSub);
  if (!normalizedOwnerSub) {
    // If the session has an ownerSub set, we require the caller to provide one.
    // Only skip validation when both the session and request lack ownerSub.
    if (session.ownerSub) {
      throw new Error('Session requires owner authentication');
    }
    return;
  }
  // Late binding is disallowed to prevent session hijacking:
  // A session without ownerSub cannot be retroactively claimed by another user.
  if (!session.ownerSub || session.ownerSub !== normalizedOwnerSub) {
    throw new OwnerBindingError();
  }
}

function getSessionExpiryReason(session: Session, now: number): SessionExpiryReason | null {
  if (now - session.lastAccessedAt >= SESSION_IDLE_TIMEOUT_MS) {
    return 'inactive_timeout';
  }
  if (now - session.createdAt >= SESSION_MAX_DURATION_MS) {
    return 'max_duration';
  }
  return null;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private mutex = new SessionMutex();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInProgress = false;

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionWithValidation(sessionId: string, spaceId: string, ownerSub?: string): Session {
    const validatedSpaceId = validateSpaceId(spaceId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.spaceId !== validatedSpaceId) {
      throw new Error('Session does not belong to the specified workspace');
    }
    enforceSessionOwnerBinding(session, ownerSub);

    const now = Date.now();
    const reason = getSessionExpiryReason(session, now);
    if (reason) {
      this.stopSessionBestEffort(sessionId, session, reason);
      throw new Error('Session not found');
    }

    session.lastAccessedAt = now;
    return session;
  }

  async getSessionDir(
    sessionId: string,
    spaceId: string,
    ownerSub?: string,
    proxyToken?: string,
  ): Promise<string> {
    if (!isValidSessionId(sessionId)) {
      throw new Error('Invalid session ID format');
    }

    const validatedSpaceId = validateSpaceId(spaceId);
    const session = await this.createSession(sessionId, validatedSpaceId, ownerSub, proxyToken);
    return session.workDir;
  }

  async destroySession(sessionId: string, spaceId?: string, ownerSub?: string): Promise<boolean> {
    await this.mutex.acquire();
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return false;
      }
      if (spaceId && session.spaceId !== validateSpaceId(spaceId)) {
        throw new Error('Session does not belong to the specified workspace');
      }
      enforceSessionOwnerBinding(session, ownerSub);

      await this.stopSession(sessionId, session, 'manual');

      return true;
    } finally {
      this.mutex.release();
    }
  }

  startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      if (this.cleanupInProgress) return;
      this.cleanupInProgress = true;

      void this.cleanupExpiredSessions()
        .catch((err) => {
          logger.error('Error in session cleanup interval', { error: err as Error });
        })
        .finally(() => {
          this.cleanupInProgress = false;
        });
    }, SESSION_CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (!this.cleanupInterval) return;
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }

  // -- Private helpers -------------------------------------------------------

  private stopSessionInMemory(sessionId: string, session: Session): void {
    if (session.heartbeatTimer) {
      clearInterval(session.heartbeatTimer);
      session.heartbeatTimer = null;
    }
    this.sessions.delete(sessionId);
  }

  private startSessionHeartbeat(session: Session): void {
    if (session.heartbeatTimer) {
      clearInterval(session.heartbeatTimer);
      session.heartbeatTimer = null;
    }

    const timer = startHeartbeat(session.id, session.proxyToken);
    if (timer) {
      session.heartbeatTimer = timer;
    }
  }

  private async stopSession(sessionId: string, session: Session, reason: SessionStopReason): Promise<void> {
    this.stopSessionInMemory(sessionId, session);

    try {
      await fs.rm(session.workDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to remove session workDir', {
        sessionId,
        workDir: session.workDir,
        error: err as Error,
      });
    }

    logger.info('Stopped session', {
      sessionId,
      spaceId: session.spaceId,
      reason,
    });
  }

  private stopSessionBestEffort(sessionId: string, session: Session, reason: SessionStopReason): void {
    void this.stopSession(sessionId, session, reason).catch((err) => {
      logger.warn('Failed to stop session', { sessionId, reason, error: err as Error });
    });
  }

  private async cleanupExpiredSessions(now: number = Date.now()): Promise<void> {
    for (const [sessionId, session] of this.sessions.entries()) {
      const reason = getSessionExpiryReason(session, now);
      if (!reason) continue;
      await this.stopSession(sessionId, session, reason);
    }
  }

  private async createSession(
    sessionId: string,
    spaceId: string,
    ownerSub?: string,
    proxyToken?: string,
  ): Promise<Session> {
    const validatedSpaceId = validateSpaceId(spaceId);
    const normalizedOwnerSub = normalizeOwnerSub(ownerSub);

    await this.mutex.acquire();
    try {
      const now = Date.now();
      await this.cleanupExpiredSessions(now);

      const existing = this.sessions.get(sessionId);
      if (existing) {
        if (existing.spaceId !== validatedSpaceId) {
          throw new Error('Session does not belong to the specified workspace');
        }
        enforceSessionOwnerBinding(existing, normalizedOwnerSub);
        if (proxyToken) {
          existing.proxyToken = proxyToken;
          this.startSessionHeartbeat(existing);
        }
        existing.lastAccessedAt = now;
        return existing;
      }

      if (this.sessions.size >= MAX_TOTAL_SESSIONS) {
        throw new Error('Maximum total sessions reached. Please try again later.');
      }
      let spaceCount = 0;
      for (const s of this.sessions.values()) {
        if (s.spaceId === validatedSpaceId) spaceCount++;
      }
      if (spaceCount >= MAX_SESSIONS_PER_WORKSPACE) {
        throw new Error('Maximum sessions per workspace reached');
      }

      const workDir = path.join(os.tmpdir(), `takos-session-${validatedSpaceId}-${sessionId}`);
      await fs.mkdir(workDir, { recursive: true });

      const sessionInfo = {
        session_id: sessionId,
        space_id: validatedSpaceId,
      };
      await fs.writeFile(
        path.join(workDir, '.takos-session'),
        JSON.stringify(sessionInfo, null, 2),
        { encoding: 'utf-8', mode: 0o600 }
      );

      const session: Session = {
        id: sessionId,
        spaceId: validatedSpaceId,
        ownerSub: normalizedOwnerSub,
        proxyToken,
        workDir,
        createdAt: now,
        lastAccessedAt: now,
        heartbeatTimer: null,
      };
      this.sessions.set(sessionId, session);
      this.startSessionHeartbeat(session);

      logger.info('Created session', { sessionId, workDir });

      return session;
    } finally {
      this.mutex.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

export const sessionStore = new SessionStore();
