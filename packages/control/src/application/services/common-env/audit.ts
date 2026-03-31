import { generateId } from '../../../shared/utils/index.ts';
import type { Env } from '../../../shared/types/index.ts';
import { getDb, serviceCommonEnvAuditLogs } from '../../../infra/db/index.ts';
import type { D1Database } from '../../../shared/types/bindings.ts';

export interface CommonEnvAuditActor {
  type: 'user' | 'system';
  userId?: string | null;
  requestId?: string;
  ipHash?: string;
  userAgent?: string;
}

export async function hashAuditIp(env: Env, ipRaw?: string): Promise<string | undefined> {
  const normalized = String(ipRaw || '').trim();
  if (!normalized) return undefined;

  const secret = String(env.AUDIT_IP_HASH_KEY || '').trim();
  if (!secret) return undefined;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized));
  const digest = new Uint8Array(signature);
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function writeCommonEnvAuditLog(params: {
  db: D1Database;
  spaceId: string;
  eventType: 'workspace_env_created' | 'workspace_env_updated' | 'workspace_env_deleted' | 'worker_link_added' | 'worker_link_removed' | 'required_link_overridden';
  envName: string;
  serviceId?: string | null;
  workerId?: string | null;
  linkSource?: 'manual' | 'required' | null;
  changeBefore?: Record<string, unknown>;
  changeAfter?: Record<string, unknown>;
  actor?: CommonEnvAuditActor;
}): Promise<void> {
  const actor = params.actor || { type: 'system' as const };
  const db = getDb(params.db);
  const serviceId = params.serviceId ?? params.workerId ?? null;
  await db.insert(serviceCommonEnvAuditLogs).values({
    id: generateId(),
    accountId: params.spaceId,
    actorAccountId: actor.userId || null,
    actorType: actor.type,
    eventType: params.eventType,
    envName: params.envName,
    serviceId,
    linkSource: params.linkSource || null,
    changeBefore: JSON.stringify(params.changeBefore || {}),
    changeAfter: JSON.stringify(params.changeAfter || {}),
    requestId: actor.requestId || null,
    ipHash: actor.ipHash || null,
    userAgent: actor.userAgent || null,
  });
}
