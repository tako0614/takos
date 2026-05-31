import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import type { OIDCState, Session } from "../../shared/types/index.ts";

import { jsonResponse } from "./do-header-utils.ts";

const SESSION_PREFIX = "session:";
const OIDC_PREFIX = "oidc:";

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

export class SessionDO {
  /**
   * Active sessions keyed by session id. Exposed for Durable Object tests
   * that need to seed expired/live entries before invoking alarm() or to
   * assert eviction behavior; production callers should not mutate this
   * map outside the class methods.
   */
  readonly sessions: Map<string, Session> = new Map();
  /**
   * Active OIDC states keyed by state value. Exposed for tests for the
   * same reason as `sessions`; production callers should not mutate this
   * map outside the class methods.
   */
  readonly oidcStates: Map<string, OIDCState> = new Map();

  constructor(private state: DurableObjectStateBinding) {
    this.state.blockConcurrencyWhile(async () => {
      // Migrate from legacy single-key format if present
      const legacy = await this.state.storage.get<{
        sessions: Record<string, Session>;
        oidcStates: Record<string, OIDCState>;
      }>("data");
      if (legacy) {
        for (const [key, value] of Object.entries(legacy.sessions || {})) {
          this.sessions.set(key, value);
        }
        for (const [key, value] of Object.entries(legacy.oidcStates || {})) {
          this.oidcStates.set(key, value);
        }
        // Persist in new per-key format and delete legacy key
        const puts: Record<string, Session | OIDCState> = {};
        for (const [key, value] of this.sessions) {
          puts[`${SESSION_PREFIX}${key}`] = value;
        }
        for (const [key, value] of this.oidcStates) {
          puts[`${OIDC_PREFIX}${key}`] = value;
        }
        if (Object.keys(puts).length > 0) {
          await this.state.storage.put(puts);
        }
        await this.state.storage.delete("data");
        return;
      }

      // Load from per-key storage
      const allEntries = await this.state.storage.list<Session | OIDCState>();
      for (const [key, value] of allEntries) {
        if (key.startsWith(SESSION_PREFIX)) {
          this.sessions.set(key.slice(SESSION_PREFIX.length), value as Session);
        } else if (key.startsWith(OIDC_PREFIX)) {
          this.oidcStates.set(
            key.slice(OIDC_PREFIX.length),
            value as OIDCState,
          );
        }
      }
    });
  }

  private async persistSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      await this.state.storage.put(`${SESSION_PREFIX}${id}`, session);
    } else {
      await this.state.storage.delete(`${SESSION_PREFIX}${id}`);
    }
  }

  private async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    await this.state.storage.delete(`${SESSION_PREFIX}${id}`);
  }

  private async persistOidcState(stateKey: string): Promise<void> {
    const oidcState = this.oidcStates.get(stateKey);
    if (oidcState) {
      await this.state.storage.put(`${OIDC_PREFIX}${stateKey}`, oidcState);
    } else {
      await this.state.storage.delete(`${OIDC_PREFIX}${stateKey}`);
    }
  }

  private async deleteOidcState(stateKey: string): Promise<void> {
    this.oidcStates.delete(stateKey);
    await this.state.storage.delete(`${OIDC_PREFIX}${stateKey}`);
  }

  private async scheduleCleanupAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm();
    if (existing) return;

    let earliestExpiry = Infinity;
    for (const session of this.sessions.values()) {
      if (session.expires_at < earliestExpiry) {
        earliestExpiry = session.expires_at;
      }
    }
    for (const oidcState of this.oidcStates.values()) {
      if (oidcState.expires_at < earliestExpiry) {
        earliestExpiry = oidcState.expires_at;
      }
    }

    if (earliestExpiry < Infinity) {
      await this.state.storage.setAlarm(
        Math.max(earliestExpiry, Date.now() + 1000),
      );
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, session] of this.sessions) {
      if (session.expires_at < now) {
        this.sessions.delete(key);
        keysToDelete.push(`${SESSION_PREFIX}${key}`);
      }
    }
    for (const [key, oidcState] of this.oidcStates) {
      if (oidcState.expires_at < now) {
        this.oidcStates.delete(key);
        keysToDelete.push(`${OIDC_PREFIX}${key}`);
      }
    }

    if (keysToDelete.length > 0) {
      await this.state.storage.delete(keysToDelete);
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
      if (path === "/session/create" && request.method === "POST") {
        const { session } = (await request.json()) as { session: Session };
        return this.state.blockConcurrencyWhile(async () => {
          const existing = this.sessions.get(session.id);
          if (existing && existing.expires_at >= Date.now()) {
            return jsonResponse({ success: true, existing: true });
          }
          this.sessions.set(session.id, session);
          await this.persistSession(session.id);
          await this.scheduleCleanupAlarm();
          return jsonResponse({ success: true });
        });
      }

      if (path === "/session/get" && request.method === "POST") {
        const { sessionId } = (await request.json()) as { sessionId: string };
        return this.state.blockConcurrencyWhile(async () => {
          const [session, evicted] = getIfValid(this.sessions, sessionId);
          if (evicted) await this.deleteSession(sessionId);
          return jsonResponse({ session });
        });
      }

      if (path === "/session/delete" && request.method === "POST") {
        const { sessionId } = (await request.json()) as { sessionId: string };
        return this.state.blockConcurrencyWhile(async () => {
          await this.deleteSession(sessionId);
          return jsonResponse({ success: true });
        });
      }

      if (path === "/oidc-state/create" && request.method === "POST") {
        const { oidcState } = (await request.json()) as {
          oidcState: OIDCState;
        };
        return this.state.blockConcurrencyWhile(async () => {
          this.oidcStates.set(oidcState.state, oidcState);
          await this.persistOidcState(oidcState.state);
          await this.scheduleCleanupAlarm();
          return jsonResponse({ success: true });
        });
      }

      if (path === "/oidc-state/get" && request.method === "POST") {
        const { state: stateKey } = (await request.json()) as {
          state: string;
        };
        return this.state.blockConcurrencyWhile(async () => {
          const [oidcState, evicted] = getIfValid(this.oidcStates, stateKey);
          if (evicted) await this.deleteOidcState(stateKey);
          return jsonResponse({ oidcState });
        });
      }

      if (path === "/oidc-state/delete" && request.method === "POST") {
        const { state: stateKey } = (await request.json()) as {
          state: string;
        };
        return this.state.blockConcurrencyWhile(async () => {
          await this.deleteOidcState(stateKey);
          return jsonResponse({ success: true });
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }
}
