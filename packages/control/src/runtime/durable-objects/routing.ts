import type { RoutingRecord, RoutingTarget } from '../../application/services/routing/routing-models.ts';

import { jsonResponse } from './do-header-utils.ts';

type StoredRoutingRecord = Omit<RoutingRecord, 'hostname'>;

const ROUTE_PREFIX = 'r:';
const TOMBSTONE_PREFIX = 't:'; // t:<hex_expiry_ms>:<hostname>
const ROLLOUT_ALARM_KEY = 'rollout:alarm';

function routeKey(hostname: string): string {
  return `${ROUTE_PREFIX}${hostname}`;
}

function padExpiryHex(expiryMs: number): string {
  // Fixed width so lexicographic order matches numeric order
  return Math.max(0, Math.floor(expiryMs)).toString(16).padStart(16, '0');
}

function tombstoneKey(tombstoneUntilMs: number, hostname: string): string {
  return `${TOMBSTONE_PREFIX}${padExpiryHex(tombstoneUntilMs)}:${hostname}`;
}

function parseTombstoneKey(key: string): { tombstoneUntilMs: number; hostname: string } | null {
  if (!key.startsWith(TOMBSTONE_PREFIX)) return null;
  const rest = key.slice(TOMBSTONE_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx === -1) return null;
  const hex = rest.slice(0, idx);
  const hostname = rest.slice(idx + 1);
  if (!hostname) return null;
  const expiry = Number.parseInt(hex, 16);
  if (!Number.isFinite(expiry) || expiry <= 0) return null;
  return { tombstoneUntilMs: expiry, hostname };
}

function isRoutingTarget(value: unknown): value is RoutingTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'deployments' && Array.isArray(v.deployments) && v.deployments.length > 0) {
    for (const entry of v.deployments) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.routeRef === 'string' && e.routeRef) return true;
    }
  }
  if (v.type === 'http-endpoint-set' && Array.isArray(v.endpoints) && v.endpoints.length > 0) return true;
  return false;
}

export class RoutingDO implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/routing/get' && request.method === 'POST') {
        const body = await request.json<{ hostname: string }>();
        return await this.handleGet(body);
      }
      if (path === '/routing/put' && request.method === 'POST') {
        const body = await request.json<{ hostname: string; target: RoutingTarget; updatedAt?: number }>();
        return await this.handlePut(body);
      }
      if (path === '/routing/delete' && request.method === 'POST') {
        const body = await request.json<{ hostname: string; tombstoneTtlMs?: number; updatedAt?: number }>();
        return await this.handleDelete(body);
      }
      if (path === '/routing/rollout/pending' && request.method === 'POST') {
        const pending = await this.state.storage.get<{ hostname: string; triggeredAt: number }>('rollout:pending_advance');
        if (pending) {
          await this.state.storage.delete('rollout:pending_advance');
          return jsonResponse({ pending: true, ...pending });
        }
        return jsonResponse({ pending: false });
      }
      if (path === '/routing/rollout/schedule' && request.method === 'POST') {
        const body = await request.json<{ hostname: string; delayMs: number }>();
        return await this.handleRolloutSchedule(body);
      }
      if (path === '/routing/rollout/cancel' && request.method === 'POST') {
        const body = await request.json<{ hostname: string }>();
        return await this.handleRolloutCancel(body);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      return jsonResponse({ error: String(error) }, 500);
    }
  }

  async alarm(): Promise<void> {
    // Check for rollout alarm first
    const rolloutData = await this.state.storage.get<{ hostname: string; alarmAt: number }>(ROLLOUT_ALARM_KEY);
    if (rolloutData && rolloutData.alarmAt <= Date.now()) {
      await this.state.storage.delete(ROLLOUT_ALARM_KEY);
      // Signal rollout advance via a stored flag that external callers can poll.
      // The actual stage advancement is handled by the RolloutService caller,
      // not inside the DO, since we don't have access to DB/Env here.
      await this.state.storage.put('rollout:pending_advance', {
        hostname: rolloutData.hostname,
        triggeredAt: Date.now(),
      });
    }

    await this.cleanupExpiredTombstones();
    await this.scheduleNextCleanupAlarm();
  }

  /**
   * Normalize and validate a hostname per DNS rules:
   * - Total length must not exceed 253 characters (RFC 1035 §2.3.4,
   *   accounting for the trailing dot which is typically omitted).
   * - Each label (between dots) must be 1–63 characters.
   * - Labels may only contain ASCII letters, digits, and hyphens.
   * - Labels must not start or end with a hyphen.
   */
  private normalizeHostname(raw: string): string | null {
    if (typeof raw !== 'string') return null;
    const hostname = raw.trim().toLowerCase();
    if (!hostname) return null;
    // RFC 1035: max 253 chars for a fully-qualified name without trailing dot
    if (hostname.length > 253) return null;

    const labels = hostname.split('.');
    // DNS name regex: letters, digits, hyphens; no leading/trailing hyphen
    const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    for (const label of labels) {
      // Each label must be 1–63 characters
      if (label.length === 0 || label.length > 63) return null;
      if (!labelRegex.test(label)) return null;
    }
    return hostname;
  }

  private async load(hostname: string): Promise<StoredRoutingRecord | null> {
    return (await this.state.storage.get<StoredRoutingRecord>(routeKey(hostname))) ?? null;
  }

  private async save(hostname: string, record: StoredRoutingRecord): Promise<void> {
    await this.state.storage.put(routeKey(hostname), record);
  }

  private async deleteRecord(hostname: string): Promise<void> {
    await this.state.storage.delete(routeKey(hostname));
  }

  private async handleGet(body: { hostname: string }): Promise<Response> {
    const hostname = this.normalizeHostname(body.hostname);
    if (!hostname) return jsonResponse({ record: null });

    const record = await this.load(hostname);
    if (!record) {
      return jsonResponse({ record: null });
    }

    const nowMs = Date.now();
    if (typeof record.tombstoneUntil === 'number' && record.tombstoneUntil > 0 && record.tombstoneUntil <= nowMs) {
      await this.deleteTombstoneIndex(hostname, record.tombstoneUntil);
      await this.deleteRecord(hostname);
      await this.scheduleNextCleanupAlarm();
      return jsonResponse({ record: null });
    }

    const response: RoutingRecord = { hostname, ...record };
    return jsonResponse({ record: response });
  }

  private async handlePut(body: { hostname: string; target: RoutingTarget; updatedAt?: number }): Promise<Response> {
    const hostname = this.normalizeHostname(body.hostname);
    if (!hostname) {
      return jsonResponse({ error: 'Invalid hostname' }, 400);
    }
    if (!isRoutingTarget(body.target)) {
      return jsonResponse({ error: 'Invalid target' }, 400);
    }

    const nowMs = Date.now();
    const updatedAt = typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt) ? body.updatedAt : nowMs;

    const prev = await this.load(hostname);
    const version = (prev?.version ?? 0) + 1;

    if (prev?.tombstoneUntil) {
      await this.deleteTombstoneIndex(hostname, prev.tombstoneUntil);
    }

    const record: StoredRoutingRecord = {
      target: body.target,
      version,
      updatedAt,
    };
    await this.save(hostname, record);

    await this.scheduleNextCleanupAlarm();

    const response: RoutingRecord = { hostname, ...record };
    return jsonResponse({ record: response });
  }

  private async handleDelete(body: { hostname: string; tombstoneTtlMs?: number; updatedAt?: number }): Promise<Response> {
    const hostname = this.normalizeHostname(body.hostname);
    if (!hostname) {
      return jsonResponse({ error: 'Invalid hostname' }, 400);
    }

    const nowMs = Date.now();
    const updatedAt = typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt) ? body.updatedAt : nowMs;

    const ttlMs = typeof body.tombstoneTtlMs === 'number' && Number.isFinite(body.tombstoneTtlMs)
      ? Math.max(1_000, Math.min(body.tombstoneTtlMs, 30 * 60_000))
      : 2 * 60_000;

    const tombstoneUntil = nowMs + ttlMs;

    const prev = await this.load(hostname);
    const version = (prev?.version ?? 0) + 1;

    if (prev?.tombstoneUntil) {
      await this.deleteTombstoneIndex(hostname, prev.tombstoneUntil);
    }

    const record: StoredRoutingRecord = {
      target: null,
      version,
      updatedAt,
      tombstoneUntil,
    };
    await this.save(hostname, record);
    await this.putTombstoneIndex(hostname, tombstoneUntil);

    await this.scheduleNextCleanupAlarm();

    const response: RoutingRecord = { hostname, ...record };
    return jsonResponse({ record: response });
  }

  private async putTombstoneIndex(hostname: string, tombstoneUntil: number): Promise<void> {
    const key = tombstoneKey(tombstoneUntil, hostname);
    await this.state.storage.put(key, 1);
  }

  private async deleteTombstoneIndex(hostname: string, tombstoneUntil: number): Promise<void> {
    const key = tombstoneKey(tombstoneUntil, hostname);
    await this.state.storage.delete(key);
  }

  private async cleanupExpiredTombstones(): Promise<void> {
    const nowMs = Date.now();

    // Process in small batches; storage.list is lexicographic by key, so earliest expiries come first.
    while (true) {
      const batch = await this.state.storage.list<number>({ prefix: TOMBSTONE_PREFIX, limit: 128 });
      if (batch.size === 0) return;

      let progressed = false;
      for (const key of batch.keys()) {
        const parsed = parseTombstoneKey(key);
        if (!parsed) {
          // Corrupt index entry; delete to avoid permanent alarm loops.
          await this.state.storage.delete(key);
          progressed = true;
          continue;
        }

        if (parsed.tombstoneUntilMs > nowMs) {
          // Remaining keys are for the future (due to ordering).
          return;
        }

        const record = await this.load(parsed.hostname);
        if (!record) {
          await this.state.storage.delete(key);
          progressed = true;
          continue;
        }

        // Only delete if this tombstone key still matches the current record.
        if (record.tombstoneUntil !== parsed.tombstoneUntilMs) {
          await this.state.storage.delete(key);
          progressed = true;
          continue;
        }

        await this.deleteRecord(parsed.hostname);
        await this.state.storage.delete(key);
        progressed = true;
      }

      if (!progressed) return;
    }
  }

  private async scheduleNextCleanupAlarm(): Promise<void> {
    const earliest = await this.state.storage.list<number>({ prefix: TOMBSTONE_PREFIX, limit: 1 });
    const key = earliest.keys().next().value as string | undefined;
    if (!key) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const parsed = parseTombstoneKey(key);
    if (!parsed) {
      // Corrupt index; drop and retry next time.
      await this.state.storage.delete(key);
      await this.state.storage.setAlarm(Date.now() + 60_000);
      return;
    }

    // Small delay to avoid tight loops.
    const alarmAt = Math.max(Date.now() + 1_000, parsed.tombstoneUntilMs);
    await this.state.storage.setAlarm(alarmAt);
  }

  // --- Rollout alarm support ---

  private async handleRolloutSchedule(body: { hostname: string; delayMs: number }): Promise<Response> {
    const alarmAt = Date.now() + Math.max(0, body.delayMs);
    await this.state.storage.put(ROLLOUT_ALARM_KEY, {
      hostname: body.hostname,
      alarmAt,
    });
    // Set or update the DO alarm to fire at the rollout time
    // (if a tombstone cleanup alarm is already earlier, the alarm fires then
    // and both tombstone + rollout checks will run)
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm || alarmAt < currentAlarm) {
      await this.state.storage.setAlarm(alarmAt);
    }
    return jsonResponse({ scheduled: true, alarmAt });
  }

  private async handleRolloutCancel(_body: { hostname: string }): Promise<Response> {
    await this.state.storage.delete(ROLLOUT_ALARM_KEY);
    return jsonResponse({ cancelled: true });
  }
}
