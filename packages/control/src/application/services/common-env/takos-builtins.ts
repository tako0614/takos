import type { D1Database } from '../../../shared/types/bindings.ts';
import { eq, and, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { ALL_SCOPES } from '../../../shared/types/oauth';
import { generateId, now } from '../../../shared/utils';
import { decrypt, encrypt, type EncryptedData } from '../../../shared/utils/crypto';
import { getCommonEnvSecret, normalizeEnvName } from './crypto';
import type { SyncState } from './repository';
import { issueTakosAccessToken } from '../identity/takos-access-tokens';
import { getDb, accounts, accountMemberships, serviceManagedTakosTokens } from '../../../infra/db';

export const TAKOS_API_URL_ENV_NAME = 'TAKOS_API_URL';
export const TAKOS_ACCESS_TOKEN_ENV_NAME = 'TAKOS_ACCESS_TOKEN';
const VALID_SCOPE_SET = new Set(ALL_SCOPES);

export type TakosTokenSubjectMode = 'owner_principal' | 'space_agent';

type SpaceIdentityRow = {
  id: string;
  kind: 'user' | 'team' | 'system';
  name: string;
  slug: string | null;
  owner_user_id: string;
  owner_principal_id: string;
};

type ManagedTakosTokenRow = {
  id: string;
  space_id: string;
  service_id: string;
  env_name: string;
  subject_user_id: string;
  subject_mode: TakosTokenSubjectMode;
  scopes_json: string;
  token_hash: string;
  token_prefix: string;
  token_encrypted: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export interface TakosBuiltinStatus {
  managed: true;
  available: boolean;
  configured?: boolean;
  scopes?: string[];
  subject_mode?: TakosTokenSubjectMode;
  sync_state?: 'managed' | 'pending' | 'missing_common' | 'missing_builtin' | 'overridden' | 'error';
  sync_reason?: string | null;
}

type LinkStateLike = {
  syncState: SyncState;
  syncReason: string | null;
};

function buildManagedTokenSalt(serviceId: string, envName: string): string {
  return `managed-takos-token:${serviceId}:${normalizeEnvName(envName)}`;
}

function parseScopesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is string => typeof scope === 'string');
  } catch {
    return [];
  }
}

export function normalizeTakosScopes(scopes: string[]): string[] {
  const normalized = [...new Set((scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error('TAKOS_ACCESS_TOKEN requires at least one scope');
  }
  const invalid = normalized.filter((scope) => !VALID_SCOPE_SET.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Unknown Takos scopes: ${invalid.join(', ')}`);
  }
  return normalized;
}

export function resolveTakosApiUrl(env: Pick<Env, 'ADMIN_DOMAIN'>): string | null {
  const adminDomain = String(env.ADMIN_DOMAIN || '').trim();
  if (!adminDomain) return null;
  return `https://${adminDomain}`;
}

async function loadSpaceIdentity(db: D1Database, spaceId: string): Promise<SpaceIdentityRow | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();
  if (!row) return null;

  const kind = row.type === 'user' ? 'user' : row.type === 'system' ? 'system' : 'team';
  const ownerUserId = row.type === 'user' ? row.id : (row.ownerAccountId ?? row.id);
  return {
    id: row.id,
    kind: kind as 'user' | 'team' | 'system',
    name: row.name,
    slug: row.slug,
    owner_user_id: ownerUserId,
    // In the current schema, account id IS the principal id
    owner_principal_id: ownerUserId,
  };
}

export async function resolveTakosTokenSubject(params: {
  env: Pick<Env, 'DB'>;
  spaceId: string;
}): Promise<{ subjectUserId: string; subjectMode: TakosTokenSubjectMode; space: SpaceIdentityRow }> {
  const space = await loadSpaceIdentity(params.env.DB, params.spaceId);
  if (!space) {
    throw new Error(`Space not found: ${params.spaceId}`);
  }
  if (space.kind === 'user') {
    return {
      subjectUserId: space.owner_user_id,
      subjectMode: 'owner_principal',
      space,
    };
  }
  // For team spaces, the account id itself acts as the principal
  return {
    subjectUserId: space.owner_user_id,
    subjectMode: 'space_agent',
    space,
  };
}

async function encryptManagedToken(env: Pick<Env, 'ENCRYPTION_KEY'>, serviceId: string, envName: string, value: string): Promise<string> {
  const encrypted = await encrypt(value, getCommonEnvSecret(env), buildManagedTokenSalt(serviceId, envName));
  return JSON.stringify(encrypted);
}

async function decryptManagedToken(env: Pick<Env, 'ENCRYPTION_KEY'>, row: ManagedTakosTokenRow): Promise<string> {
  let encrypted: EncryptedData;
  try {
    encrypted = JSON.parse(row.token_encrypted) as EncryptedData;
  } catch (err) {
    throw new Error(`Failed to parse encrypted token for service ${row.service_id}, env ${row.env_name}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return decrypt(encrypted, getCommonEnvSecret(env), buildManagedTokenSalt(row.service_id, row.env_name));
}

function toManagedTokenRow(row: typeof serviceManagedTakosTokens.$inferSelect): ManagedTakosTokenRow {
  return {
    id: row.id,
    space_id: row.accountId,
    service_id: row.serviceId,
    env_name: row.envName,
    subject_user_id: row.subjectAccountId,
    subject_mode: row.subjectMode as TakosTokenSubjectMode,
    scopes_json: row.scopesJson,
    token_hash: row.tokenHash,
    token_prefix: row.tokenPrefix,
    token_encrypted: row.tokenEncrypted,
    last_used_at: row.lastUsedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function listManagedRow(
  db: D1Database,
  spaceId: string,
  serviceId: string,
  envName = TAKOS_ACCESS_TOKEN_ENV_NAME,
): Promise<ManagedTakosTokenRow | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(serviceManagedTakosTokens)
    .where(and(
      eq(serviceManagedTakosTokens.accountId, spaceId),
      eq(serviceManagedTakosTokens.serviceId, serviceId),
      eq(serviceManagedTakosTokens.envName, envName),
    ))
    .limit(1)
    .get();
  return row ? toManagedTokenRow(row) : null;
}

export async function deleteManagedTakosTokenConfig(params: {
  env: Pick<Env, 'DB'>;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  envName?: string;
}): Promise<void> {
  const envName = normalizeEnvName(params.envName || TAKOS_ACCESS_TOKEN_ENV_NAME);
  const serviceId = params.serviceId ?? params.workerId ?? '';
  if (!serviceId) {
    throw new Error('deleteManagedTakosTokenConfig requires a serviceId');
  }
  const existing = await listManagedRow(params.env.DB, params.spaceId, serviceId, envName);
  if (!existing) return;

  const drizzle = getDb(params.env.DB);
  await drizzle.delete(serviceManagedTakosTokens)
    .where(eq(serviceManagedTakosTokens.id, existing.id));
}

export async function upsertManagedTakosTokenConfig(params: {
  env: Pick<Env, 'DB' | 'ENCRYPTION_KEY'>;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  scopes: string[];
  envName?: string;
}): Promise<void> {
  const envName = normalizeEnvName(params.envName || TAKOS_ACCESS_TOKEN_ENV_NAME);
  const scopes = normalizeTakosScopes(params.scopes);
  const serviceId = params.serviceId ?? params.workerId ?? '';
  if (!serviceId) {
    throw new Error('upsertManagedTakosTokenConfig requires a serviceId');
  }
  const existing = await listManagedRow(params.env.DB, params.spaceId, serviceId, envName);
  const resolved = await resolveTakosTokenSubject({
    env: params.env,
    spaceId: params.spaceId,
  });
  const scopesJson = JSON.stringify(scopes);

  if (
    existing
    && existing.subject_user_id === resolved.subjectUserId
    && existing.subject_mode === resolved.subjectMode
    && existing.scopes_json === scopesJson
  ) {
    return;
  }

  const issued = await issueTakosAccessToken();
  const tokenEncrypted = await encryptManagedToken(params.env, serviceId, envName, issued.token);
  const timestamp = now();
  const rowId = existing?.id || generateId();

  const drizzle = getDb(params.env.DB);
  await drizzle.insert(serviceManagedTakosTokens)
    .values({
      id: rowId,
      accountId: params.spaceId,
      serviceId,
      envName,
      subjectAccountId: resolved.subjectUserId,
      subjectMode: resolved.subjectMode,
      scopesJson,
      tokenHash: issued.tokenHash,
      tokenPrefix: issued.tokenPrefix,
      tokenEncrypted,
      lastUsedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [serviceManagedTakosTokens.serviceId, serviceManagedTakosTokens.envName],
      set: {
        subjectAccountId: resolved.subjectUserId,
        subjectMode: resolved.subjectMode,
        scopesJson,
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.tokenPrefix,
        tokenEncrypted,
        lastUsedAt: null,
        updatedAt: timestamp,
      },
    });
}

export async function ensureManagedTakosTokenValue(params: {
  env: Pick<Env, 'DB' | 'ENCRYPTION_KEY'>;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  envName?: string;
}): Promise<{ value: string; scopes: string[]; subjectMode: TakosTokenSubjectMode } | null> {
  const serviceId = params.serviceId ?? params.workerId ?? '';
  if (!serviceId) {
    throw new Error('ensureManagedTakosTokenValue requires a serviceId');
  }
  const envName = normalizeEnvName(params.envName || TAKOS_ACCESS_TOKEN_ENV_NAME);
  let row = await listManagedRow(params.env.DB, params.spaceId, serviceId, envName);
  if (!row) return null;

  const scopes = normalizeTakosScopes(parseScopesJson(row.scopes_json));
  const resolved = await resolveTakosTokenSubject({
    env: params.env,
    spaceId: params.spaceId,
  });

  if (row.subject_user_id !== resolved.subjectUserId || row.subject_mode !== resolved.subjectMode) {
    await upsertManagedTakosTokenConfig({
      env: params.env,
      spaceId: params.spaceId,
      serviceId,
      envName,
      scopes,
    });
    row = await listManagedRow(params.env.DB, params.spaceId, serviceId, envName);
    if (!row) return null;
  }

  let value: string;
  try {
    value = await decryptManagedToken(params.env, row);
  } catch {
    await upsertManagedTakosTokenConfig({
      env: params.env,
      spaceId: params.spaceId,
      serviceId,
      envName,
      scopes,
    });
    row = await listManagedRow(params.env.DB, params.spaceId, serviceId, envName);
    if (!row) return null;
    value = await decryptManagedToken(params.env, row);
  }

  return {
    value,
    scopes,
    subjectMode: row.subject_mode,
  };
}

export async function listTakosBuiltinStatuses(params: {
  env: Pick<Env, 'DB' | 'ADMIN_DOMAIN'>;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  linkStateByName?: Map<string, LinkStateLike>;
}): Promise<Record<string, TakosBuiltinStatus>> {
  const serviceId = params.serviceId ?? params.workerId ?? '';
  if (!serviceId) {
    throw new Error('listTakosBuiltinStatuses requires a serviceId');
  }
  const space = await loadSpaceIdentity(params.env.DB, params.spaceId);
  if (!space) {
    throw new Error(`Space not found: ${params.spaceId}`);
  }
  const managedToken = await listManagedRow(
    params.env.DB,
    params.spaceId,
    serviceId,
    TAKOS_ACCESS_TOKEN_ENV_NAME,
  );
  const apiUrl = resolveTakosApiUrl(params.env);
  const apiLinkState = params.linkStateByName?.get(TAKOS_API_URL_ENV_NAME) || null;
  const tokenLinkState = params.linkStateByName?.get(TAKOS_ACCESS_TOKEN_ENV_NAME) || null;

  return {
    [TAKOS_API_URL_ENV_NAME]: {
      managed: true,
      available: Boolean(apiUrl),
      sync_state: apiLinkState
        ? (apiLinkState.syncState === 'missing_common' ? 'missing_builtin' : apiLinkState.syncState)
        : (apiUrl ? 'managed' : 'error'),
      sync_reason: apiLinkState?.syncReason ?? (apiUrl ? null : 'admin_domain_missing'),
    },
    [TAKOS_ACCESS_TOKEN_ENV_NAME]: {
      managed: true,
      available: true,
      configured: Boolean(managedToken),
      scopes: managedToken ? parseScopesJson(managedToken.scopes_json) : [],
      subject_mode: space.kind === 'user' ? 'owner_principal' : 'space_agent',
      sync_state: tokenLinkState
        ? (tokenLinkState.syncState === 'missing_common' ? 'missing_builtin' : tokenLinkState.syncState)
        : (managedToken ? 'managed' : 'pending'),
      sync_reason: tokenLinkState?.syncReason ?? (managedToken ? null : 'missing_config'),
    },
  };
}

export async function markManagedTakosTokenUsedByHash(db: D1Database, tokenHash: string): Promise<void> {
  const drizzle = getDb(db);
  const timestamp = now();
  await drizzle.update(serviceManagedTakosTokens)
    .set({
      lastUsedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(serviceManagedTakosTokens.tokenHash, tokenHash));
}
