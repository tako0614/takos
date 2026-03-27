import type { D1Database } from '../../../shared/types/bindings.ts';
import { oauthDeviceCodes } from '../../../infra/db';
import type { OAuthDeviceCode } from '../../../shared/types/oauth';
import { OAUTH_CONSTANTS } from '../../../shared/types/oauth';
import { generateId, generateRandomString } from './pkce';
import { computeSHA256 } from '../../../shared/utils/hash';
import { getDb } from '../../../infra/db';
import { eq, and, isNull } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';

type OAuthDeviceCodeRow = typeof oauthDeviceCodes.$inferSelect;

function toOptionalIsoString(value: string | Date | null | undefined): string | null {
  return toIsoString(value);
}

function toApiDeviceCode(row: OAuthDeviceCodeRow): OAuthDeviceCode {
  return {
    id: row.id,
    device_code_hash: row.deviceCodeHash,
    user_code_hash: row.userCodeHash,
    client_id: row.clientId,
    scope: row.scope,
    status: row.status as OAuthDeviceCode['status'],
    user_id: row.accountId ?? null,
    interval_seconds: row.intervalSeconds,
    last_polled_at: toOptionalIsoString(row.lastPolledAt),
    approved_at: toOptionalIsoString(row.approvedAt),
    denied_at: toOptionalIsoString(row.deniedAt),
    used_at: toOptionalIsoString(row.usedAt),
    expires_at: toIsoString(row.expiresAt),
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeUserCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatUserCode(normalized: string): string {
  const size = OAUTH_CONSTANTS.DEVICE_USER_CODE_LENGTH;
  const value = normalized.slice(0, size);
  const group = 4;
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += group) {
    parts.push(value.slice(i, i + group));
  }
  return parts.join('-');
}

function generateUserCodeNormalized(): string {
  const size = OAUTH_CONSTANTS.DEVICE_USER_CODE_LENGTH;
  const out: string[] = [];
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < size; i++) {
    const idx = bytes[i] % USER_CODE_ALPHABET.length;
    out.push(USER_CODE_ALPHABET[idx]!);
  }
  return out.join('');
}

export interface CreatedDeviceAuthorization {
  id: string;
  deviceCode: string;
  userCode: string; // human display (e.g. "ABCD-EFGH")
  expiresIn: number;
  interval: number;
  expiresAt: string;
}

export async function createDeviceAuthorization(
  dbBinding: D1Database,
  params: {
    clientId: string;
    scope: string;
    expiresInSeconds?: number;
    intervalSeconds?: number;
  }
): Promise<CreatedDeviceAuthorization> {
  const db = getDb(dbBinding);
  const expiresIn = params.expiresInSeconds ?? OAUTH_CONSTANTS.DEVICE_CODE_EXPIRES_IN;
  const interval = params.intervalSeconds ?? OAUTH_CONSTANTS.DEVICE_POLL_INTERVAL_SECONDS;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    const deviceCode = generateRandomString(OAUTH_CONSTANTS.DEVICE_CODE_LENGTH);
    const userCodeNormalized = generateUserCodeNormalized();
    const userCode = formatUserCode(userCodeNormalized);

    const deviceCodeHash = await computeSHA256(deviceCode);
    const userCodeHash = await computeSHA256(userCodeNormalized);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    try {
      await db.insert(oauthDeviceCodes).values({
        id,
        deviceCodeHash,
        userCodeHash,
        clientId: params.clientId,
        scope: params.scope,
        status: 'pending',
        accountId: null,
        intervalSeconds: interval,
        lastPolledAt: null,
        approvedAt: null,
        deniedAt: null,
        usedAt: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      return {
        id,
        deviceCode,
        userCode,
        expiresIn,
        interval,
        expiresAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE') || message.includes('unique')) {
        continue;
      }
      throw err;
    }
  }

  throw new Error('Failed to generate unique device authorization codes');
}

export async function getDeviceAuthorizationByUserCode(
  dbBinding: D1Database,
  rawUserCode: string
): Promise<OAuthDeviceCode | null> {
  const db = getDb(dbBinding);
  const normalized = normalizeUserCode(rawUserCode);
  if (!normalized) return null;
  const userCodeHash = await computeSHA256(normalized);

  const result = await db.select().from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.userCodeHash, userCodeHash)).get();
  if (!result) return null;
  return toApiDeviceCode(result);
}

export async function getDeviceAuthorizationByDeviceCode(
  dbBinding: D1Database,
  deviceCode: string
): Promise<OAuthDeviceCode | null> {
  const db = getDb(dbBinding);
  if (!deviceCode) return null;
  const deviceCodeHash = await computeSHA256(deviceCode);

  const result = await db.select().from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.deviceCodeHash, deviceCodeHash)).get();
  if (!result) return null;
  return toApiDeviceCode(result);
}

async function resolveDeviceAuthorization(
  dbBinding: D1Database,
  params: { id: string; userId: string },
  decision: 'approved' | 'denied',
): Promise<boolean> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  const timestampField = decision === 'approved' ? 'approvedAt' : 'deniedAt';

  const result = await db.update(oauthDeviceCodes).set({
    status: decision,
    accountId: params.userId,
    [timestampField]: now,
    updatedAt: now,
  }).where(
    and(
      eq(oauthDeviceCodes.id, params.id),
      eq(oauthDeviceCodes.status, 'pending'),
    )
  );

  return (result.meta.changes ?? 0) > 0;
}

export async function approveDeviceAuthorization(
  dbBinding: D1Database,
  params: { id: string; userId: string }
): Promise<boolean> {
  return resolveDeviceAuthorization(dbBinding, params, 'approved');
}

export async function denyDeviceAuthorization(
  dbBinding: D1Database,
  params: { id: string; userId: string }
): Promise<boolean> {
  return resolveDeviceAuthorization(dbBinding, params, 'denied');
}

export type DeviceCodePollResult =
  | { kind: 'not_found' }
  | { kind: 'client_mismatch' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'used' }
  | { kind: 'pending'; slowDown: boolean; intervalSeconds: number }
  | { kind: 'approved'; id: string; userId: string; scope: string };

export async function pollDeviceAuthorization(
  dbBinding: D1Database,
  params: { deviceCode: string; clientId: string }
): Promise<DeviceCodePollResult> {
  const db = getDb(dbBinding);
  const deviceCode = params.deviceCode;
  if (!deviceCode) return { kind: 'not_found' };
  const deviceCodeHash = await computeSHA256(deviceCode);

  const record = await db.select().from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.deviceCodeHash, deviceCodeHash)).get();
  if (!record) return { kind: 'not_found' };

  const api = toApiDeviceCode(record);

  if (api.client_id !== params.clientId) {
    return { kind: 'client_mismatch' };
  }

  const nowMs = Date.now();
  if (new Date(api.expires_at).getTime() <= nowMs) {
    return { kind: 'expired' };
  }

  const lastMs = api.last_polled_at ? new Date(api.last_polled_at).getTime() : null;
  const currentInterval = Number.isFinite(api.interval_seconds) ? api.interval_seconds : OAUTH_CONSTANTS.DEVICE_POLL_INTERVAL_SECONDS;

  let slowDown = false;
  let nextInterval = currentInterval;
  if (lastMs !== null && nowMs - lastMs < currentInterval * 1000) {
    slowDown = true;
    nextInterval = Math.min(currentInterval + 5, 60);
  }

  const nowIso = new Date(nowMs).toISOString();
  await db.update(oauthDeviceCodes).set({
    lastPolledAt: nowIso,
    intervalSeconds: nextInterval,
    updatedAt: nowIso,
  }).where(eq(oauthDeviceCodes.id, api.id));

  switch (api.status) {
    case 'pending':
      return { kind: 'pending', slowDown, intervalSeconds: nextInterval };
    case 'denied':
      return { kind: 'denied' };
    case 'used':
      return { kind: 'used' };
    case 'approved':
      // Fail-close if user_id is unexpectedly missing
      if (!api.user_id) return { kind: 'not_found' };
      return { kind: 'approved', id: api.id, userId: api.user_id, scope: api.scope };
    default:
      return { kind: 'not_found' };
  }
}

export async function consumeApprovedDeviceAuthorization(
  dbBinding: D1Database,
  id: string
): Promise<boolean> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const result = await db.update(oauthDeviceCodes).set({
    status: 'used',
    usedAt: now,
    updatedAt: now,
  }).where(
    and(
      eq(oauthDeviceCodes.id, id),
      eq(oauthDeviceCodes.status, 'approved'),
      isNull(oauthDeviceCodes.usedAt),
    )
  );

  return (result.meta.changes ?? 0) > 0;
}
