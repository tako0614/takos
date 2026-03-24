import type { D1Database } from '../../../shared/types/bindings.ts';
import { ALL_SCOPES } from '../../../shared/types/oauth';
import { computeSHA256 } from '../../../shared/utils/hash';
import { getDb, personalAccessTokens, serviceManagedTakosTokens } from '../../../infra/db';
import { eq } from 'drizzle-orm';

export type TakosAccessTokenValidation = {
  userId: string;
  scopes: string[];
  tokenKind: 'personal' | 'managed_builtin';
};

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function parseScopesPayload(raw: string | null | undefined): string[] | null {
  if (raw === '*') {
    return [...ALL_SCOPES];
  }

  try {
    const parsed = JSON.parse(raw || 'null') as unknown;
    if (!Array.isArray(parsed) || !parsed.every((scope) => typeof scope === 'string')) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function hasRequiredScopes(scopes: string[], requiredScopes?: string[]): boolean {
  if (!requiredScopes?.length) return true;
  return requiredScopes.every((scope) => scopes.includes(scope));
}

async function validateManagedTakosToken(
  d1: D1Database,
  token: string,
  requiredScopes?: string[]
): Promise<TakosAccessTokenValidation | null> {
  const tokenHash = await computeSHA256(token);
  const db = getDb(d1);

  const row = await db.select({
    id: serviceManagedTakosTokens.id,
    subjectAccountId: serviceManagedTakosTokens.subjectAccountId,
    scopesJson: serviceManagedTakosTokens.scopesJson,
  })
    .from(serviceManagedTakosTokens)
    .where(eq(serviceManagedTakosTokens.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  const scopes = parseScopesPayload(row.scopesJson);
  if (!scopes || !hasRequiredScopes(scopes, requiredScopes)) {
    return null;
  }

  const nowIso = new Date().toISOString();
  db.update(serviceManagedTakosTokens)
    .set({ lastUsedAt: nowIso, updatedAt: nowIso })
    .where(eq(serviceManagedTakosTokens.id, row.id))
    .run();

  return {
    userId: row.subjectAccountId,
    scopes,
    tokenKind: 'managed_builtin',
  };
}

async function validatePersonalAccessToken(
  d1: D1Database,
  token: string,
  requiredScopes?: string[]
): Promise<TakosAccessTokenValidation | null> {
  const tokenHash = await computeSHA256(token);
  const db = getDb(d1);

  const row = await db.select({
    id: personalAccessTokens.id,
    accountId: personalAccessTokens.accountId,
    scopes: personalAccessTokens.scopes,
    expiresAt: personalAccessTokens.expiresAt,
  })
    .from(personalAccessTokens)
    .where(eq(personalAccessTokens.tokenHash, tokenHash))
    .get();

  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

  const scopes = parseScopesPayload(row.scopes);
  if (!scopes || !hasRequiredScopes(scopes, requiredScopes)) {
    return null;
  }

  db.update(personalAccessTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(personalAccessTokens.id, row.id))
    .run();

  return {
    userId: row.accountId,
    scopes,
    tokenKind: 'personal',
  };
}

export async function validateTakosAccessToken(
  db: D1Database,
  token: string,
  requiredScopes?: string[]
): Promise<TakosAccessTokenValidation | null> {
  return (
    await validateManagedTakosToken(db, token, requiredScopes)
    || await validatePersonalAccessToken(db, token, requiredScopes)
  );
}

export async function validateTakosPersonalAccessToken(
  db: D1Database,
  token: string,
  requiredScopes?: string[]
): Promise<TakosAccessTokenValidation | null> {
  return validatePersonalAccessToken(db, token, requiredScopes);
}

export async function issueTakosAccessToken(): Promise<{
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}> {
  const tokenBytes = generateRandomBytes(32);
  const token = `tak_pat_${toBase64Url(tokenBytes)}`;
  const tokenHash = await computeSHA256(token);
  const tokenPrefix = token.slice(0, 12);
  return {
    token,
    tokenHash,
    tokenPrefix,
  };
}
