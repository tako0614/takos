import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import { oauthConsents, oauthClients } from '../../../infra/db';
import type { OAuthConsent } from '../../../shared/types/oauth';
import { generateId } from './pkce';
import { safeJsonParseOrDefault, toIsoString } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { revokeAllUserClientTokens } from './token';

type OAuthConsentRow = SelectOf<typeof oauthConsents>;

function toApiConsent(row: OAuthConsentRow): OAuthConsent {
  return {
    id: row.id,
    user_id: row.accountId,
    client_id: row.clientId,
    scopes: row.scopes,
    status: row.status as 'active' | 'revoked',
    granted_at: toIsoString(row.grantedAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

export async function getConsent(
  dbBinding: D1Database,
  userId: string,
  clientId: string
): Promise<OAuthConsent | null> {
  const db = getDb(dbBinding);

  const consent = await db.select().from(oauthConsents).where(
    and(
      eq(oauthConsents.accountId, userId),
      eq(oauthConsents.clientId, clientId),
      eq(oauthConsents.status, 'active'),
    )
  ).get();

  if (!consent) {
    return null;
  }

  return toApiConsent(consent);
}

function parseGrantedScopes(consent: OAuthConsent): Set<string> {
  return new Set(safeJsonParseOrDefault<string[]>(consent.scopes, []));
}

export async function hasFullConsent(
  dbBinding: D1Database,
  userId: string,
  clientId: string,
  requestedScopes: string[]
): Promise<boolean> {
  const consent = await getConsent(dbBinding, userId, clientId);
  if (!consent) return false;

  const granted = parseGrantedScopes(consent);
  return requestedScopes.every((scope) => granted.has(scope));
}

export async function getNewScopes(
  dbBinding: D1Database,
  userId: string,
  clientId: string,
  requestedScopes: string[]
): Promise<string[]> {
  const consent = await getConsent(dbBinding, userId, clientId);
  if (!consent) return requestedScopes;

  const granted = parseGrantedScopes(consent);
  return requestedScopes.filter((scope) => !granted.has(scope));
}

export async function grantConsent(
  dbBinding: D1Database,
  userId: string,
  clientId: string,
  scopes: string[]
): Promise<OAuthConsent> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const existing = await getConsent(dbBinding, userId, clientId);

  if (existing) {
    const existingScopes = safeJsonParseOrDefault<string[]>(existing.scopes, []);
    const mergedScopes = Array.from(new Set([...existingScopes, ...scopes]));

    await db.update(oauthConsents).set({
      scopes: JSON.stringify(mergedScopes),
      updatedAt: now,
    }).where(eq(oauthConsents.id, existing.id));

    return {
      ...existing,
      scopes: JSON.stringify(mergedScopes),
      updated_at: now,
    };
  }

  const id = generateId();

  await db.insert(oauthConsents).values({
    id,
    accountId: userId,
    clientId,
    scopes: JSON.stringify(scopes),
    status: 'active',
    grantedAt: now,
    updatedAt: now,
  });

  return {
    id,
    user_id: userId,
    client_id: clientId,
    scopes: JSON.stringify(scopes),
    status: 'active',
    granted_at: now,
    updated_at: now,
  };
}

export async function revokeConsent(
  dbBinding: D1Database,
  userId: string,
  clientId: string
): Promise<boolean> {
  const db = getDb(dbBinding);

  try {
    const result = await db.update(oauthConsents).set({
      status: 'revoked',
      updatedAt: new Date().toISOString(),
    }).where(
      and(
        eq(oauthConsents.accountId, userId),
        eq(oauthConsents.clientId, clientId),
      )
    );

    if ((result.meta.changes ?? 0) > 0) {
      await revokeAllUserClientTokens(dbBinding, userId, clientId);
    }

    return (result.meta.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function removeConsentScopes(
  dbBinding: D1Database,
  userId: string,
  clientId: string,
  scopesToRemove: string[]
): Promise<boolean> {
  const db = getDb(dbBinding);

  const consent = await getConsent(dbBinding, userId, clientId);
  if (!consent) {
    return false;
  }

  const currentScopes = safeJsonParseOrDefault<string[]>(consent.scopes, []);
  const removeSet = new Set(scopesToRemove);
  const remainingScopes = currentScopes.filter((s) => !removeSet.has(s));

  if (remainingScopes.length === 0) {
      return revokeConsent(dbBinding, userId, clientId);
  }

  await db.update(oauthConsents).set({
    scopes: JSON.stringify(remainingScopes),
    updatedAt: new Date().toISOString(),
  }).where(eq(oauthConsents.id, consent.id));

  return true;
}

export async function getUserConsents(
  dbBinding: D1Database,
  userId: string
): Promise<OAuthConsent[]> {
  const db = getDb(dbBinding);

  const consents = await db.select().from(oauthConsents).where(
    and(
      eq(oauthConsents.accountId, userId),
      eq(oauthConsents.status, 'active'),
    )
  ).orderBy(desc(oauthConsents.grantedAt)).all();

  return consents.map(toApiConsent);
}

export interface ConsentWithClient extends OAuthConsent {
  client_name?: string;
  client_logo?: string;
  client_uri?: string;
}

export async function getUserConsentsWithClients(
  dbBinding: D1Database,
  userId: string
): Promise<ConsentWithClient[]> {
  const db = getDb(dbBinding);

  const consents = await db.select().from(oauthConsents).where(
    and(
      eq(oauthConsents.accountId, userId),
      eq(oauthConsents.status, 'active'),
    )
  ).orderBy(desc(oauthConsents.grantedAt)).all();

  if (consents.length === 0) {
    return [];
  }

  const clientIds = Array.from(new Set(consents.map((c) => c.clientId)));
  const clients = await db.select({
    clientId: oauthClients.clientId,
    name: oauthClients.name,
    logoUri: oauthClients.logoUri,
    clientUri: oauthClients.clientUri,
  }).from(oauthClients).where(
    inArray(oauthClients.clientId, clientIds)
  ).all();

  const clientMap = new Map(clients.map((c) => [c.clientId, c]));

  return consents.map((consent): ConsentWithClient => {
    const client = clientMap.get(consent.clientId);
    return {
      ...toApiConsent(consent),
      client_name: client?.name,
      client_logo: client?.logoUri ?? undefined,
      client_uri: client?.clientUri ?? undefined,
    };
  });
}
