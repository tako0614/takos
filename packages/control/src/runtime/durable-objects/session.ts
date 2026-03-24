import type { Session, OIDCState } from '../../shared/types';

import { jsonResponse } from './shared';

interface PersistedData {
  sessions: Record<string, Session>;
  oidcStates: Record<string, OIDCState>;
}

/**
 * Lookup an entry by key, returning it if present and not expired.
 * Evicts expired entries from the map and signals via the second tuple element
 * whether the caller should persist the change.
 */
function getIfValid<T extends { expires_at: number }>(
  map: Map<string, T>,
  key: string,
): [value: T | null, evicted: boolean] {
  const entry = map.get(key);
  if (!entry) return [null, false];
  if (entry.expires_at < Date.now()) {
    map.delete(key);
    return [null, true];
  }
  return [entry, false];
}

export class SessionDO implements DurableObject {
  private sessions: Map<string, Session> = new Map();
  private oidcStates: Map<string, OIDCState> = new Map();

  constructor(private state: DurableObjectState) {
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<PersistedData>('data');
      if (stored) {
        this.sessions = new Map(Object.entries(stored.sessions || {}));
        this.oidcStates = new Map(Object.entries(stored.oidcStates || {}));
      }
    });
  }

  private async persist(): Promise<void> {
    const data: PersistedData = {
      sessions: Object.fromEntries(this.sessions),
      oidcStates: Object.fromEntries(this.oidcStates),
    };
    await this.state.storage.put('data', data);
  }

  private async scheduleCleanupAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing) return;

    let earliestExpiry = Infinity;
    for (const session of this.sessions.values()) {
      if (session.expires_at < earliestExpiry) earliestExpiry = session.expires_at;
    }
    for (const oidcState of this.oidcStates.values()) {
      if (oidcState.expires_at < earliestExpiry) earliestExpiry = oidcState.expires_at;
    }

    if (earliestExpiry < Infinity) {
      await this.state.storage.setAlarm(Math.max(earliestExpiry, Date.now() + 1000));
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let evicted = false;

    for (const [key, session] of this.sessions) {
      if (session.expires_at < now) {
        this.sessions.delete(key);
        evicted = true;
      }
    }
    for (const [key, oidcState] of this.oidcStates) {
      if (oidcState.expires_at < now) {
        this.oidcStates.delete(key);
        evicted = true;
      }
    }

    if (evicted) {
      await this.persist();
    }

    await this.scheduleCleanupAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // All state-mutating handlers are wrapped in blockConcurrencyWhile
      // to prevent races. Without this, two concurrent /session/create
      // requests could both read the sessions map, find no existing
      // session, and both create one -- the second silently overwrites
      // the first. Similarly, /session/get may evict and persist, which
      // races with concurrent creates/deletes.
      if (path === '/session/create' && request.method === 'POST') {
        const { session } = await request.json<{ session: Session }>();
        return this.state.blockConcurrencyWhile(async () => {
          const existing = this.sessions.get(session.id);
          if (existing && existing.expires_at >= Date.now()) {
            return jsonResponse({ success: true, existing: true });
          }
          this.sessions.set(session.id, session);
          await this.persist();
          await this.scheduleCleanupAlarm();
          return jsonResponse({ success: true });
        });
      }

      if (path === '/session/get' && request.method === 'POST') {
        const { sessionId } = await request.json<{ sessionId: string }>();
        return this.state.blockConcurrencyWhile(async () => {
          const [session, evicted] = getIfValid(this.sessions, sessionId);
          if (evicted) await this.persist();
          return jsonResponse({ session });
        });
      }

      if (path === '/session/delete' && request.method === 'POST') {
        const { sessionId } = await request.json<{ sessionId: string }>();
        return this.state.blockConcurrencyWhile(async () => {
          this.sessions.delete(sessionId);
          await this.persist();
          return jsonResponse({ success: true });
        });
      }

      if (path === '/oidc-state/create' && request.method === 'POST') {
        const { oidcState } = await request.json<{ oidcState: OIDCState }>();
        return this.state.blockConcurrencyWhile(async () => {
          this.oidcStates.set(oidcState.state, oidcState);
          await this.persist();
          await this.scheduleCleanupAlarm();
          return jsonResponse({ success: true });
        });
      }

      if (path === '/oidc-state/get' && request.method === 'POST') {
        const { state: stateKey } = await request.json<{ state: string }>();
        return this.state.blockConcurrencyWhile(async () => {
          const [oidcState, evicted] = getIfValid(this.oidcStates, stateKey);
          if (evicted) await this.persist();
          return jsonResponse({ oidcState });
        });
      }

      if (path === '/oidc-state/delete' && request.method === 'POST') {
        const { state: stateKey } = await request.json<{ state: string }>();
        return this.state.blockConcurrencyWhile(async () => {
          this.oidcStates.delete(stateKey);
          await this.persist();
          return jsonResponse({ success: true });
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }
}
