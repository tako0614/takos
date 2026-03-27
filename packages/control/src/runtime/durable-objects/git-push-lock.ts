import { jsonResponse } from './shared';

// 5-minute lease is sized for the 90MB packfile upload limit: even worst-case
// large pushes complete well within this window (Workers CPU time limit is 30s,
// plus I/O wait). The alarm-based auto-cleanup prevents deadlocks if a worker
// crashes mid-push.
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

type LockRecord = {
  token: string;
  expiresAt: number;
};

export class GitPushLockDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/acquire') {
      return this.acquire(request);
    }

    if (url.pathname === '/release') {
      return this.release(request);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }

  private async acquire(request: Request): Promise<Response> {
    const body = await request.json().catch((err) => {
      console.warn('[git-push-lock] Failed to parse acquire request body, using defaults', err);
      return {};
    }) as { token?: string; leaseMs?: number };
    const token = typeof body.token === 'string' && body.token.length > 0
      ? body.token
      : crypto.randomUUID();
    const leaseMs = Math.max(1_000, Math.min(DEFAULT_LEASE_MS, Number(body.leaseMs) || DEFAULT_LEASE_MS));
    const now = Date.now();

    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.state.storage.get<LockRecord>('lock');
      if (current && current.expiresAt > now) {
        return jsonResponse({ ok: false, error: 'push already in progress', expires_at: current.expiresAt }, 409);
      }

      const next: LockRecord = { token, expiresAt: now + leaseMs };
      await this.state.storage.put('lock', next);
      await this.state.storage.setAlarm(next.expiresAt);
      return jsonResponse({ ok: true, token, expires_at: next.expiresAt });
    });
  }

  private async release(request: Request): Promise<Response> {
    const body = await request.json().catch((err) => {
      console.warn('[git-push-lock] Failed to parse release request body, using defaults', err);
      return {};
    }) as { token?: string };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return jsonResponse({ error: 'token is required' }, 400);
    }

    return this.state.blockConcurrencyWhile(async () => {
      const current = await this.state.storage.get<LockRecord>('lock');
      if (!current) {
        return jsonResponse({ ok: true, released: false });
      }
      if (current.token !== body.token) {
        return jsonResponse({ error: 'lock token mismatch' }, 409);
      }

      await this.state.storage.delete('lock');
      await this.state.storage.deleteAlarm();
      return jsonResponse({ ok: true, released: true });
    });
  }

  async alarm(): Promise<void> {
    const current = await this.state.storage.get<LockRecord>('lock');
    if (!current) return;
    if (current.expiresAt <= Date.now()) {
      await this.state.storage.delete('lock');
    } else {
      // Lock still active - re-schedule alarm for expiry
      await this.state.storage.setAlarm(current.expiresAt);
    }
  }
}
