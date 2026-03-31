import { Hono } from 'hono';
import type { Env, User } from '../../shared/types/index.ts';
import { safeJsonParseOrDefault, generateId, base64UrlEncode } from '../../shared/utils/index.ts';
import { validateUsername } from '../../shared/utils/domain-validation.ts';
import { getDb } from '../../infra/db/index.ts';
import { accounts, oauthTokens, oauthAuditLogs, personalAccessTokens } from '../../infra/db/schema.ts';
import { eq, and, ne, desc } from 'drizzle-orm';
import { getUserConsentsWithClients, revokeConsent } from '../../application/services/oauth/consent.ts';
import { getClientsByOwner, createClient, updateClient, deleteClient } from '../../application/services/oauth/client.ts';
import type { ClientRegistrationRequest } from '../../shared/types/oauth.ts';
import { parseJsonStringArray } from '../../shared/types/oauth.ts';
import { logOAuthEvent } from '../../application/services/oauth/audit.ts';
import { parseJsonBody, type BaseVariables } from './route-auth.ts';
import { parsePagination } from '../../shared/utils/index.ts';
import { BadRequestError, AuthorizationError, NotFoundError, ConflictError, InternalError } from 'takos-common/errors';
import { logWarn } from '../../shared/utils/logger.ts';
import {
  ensureUserSettings,
  updateUserSettings,
  formatUserSettingsResponse,
} from '../../application/services/identity/user-settings.ts';
import { toUserResponse } from '../../application/services/identity/response-formatters.ts';
import { getOrCreatePersonalWorkspace } from '../../application/services/identity/spaces.ts';
import { computeSHA256 } from '../../shared/utils/hash.ts';

// ── PAT token helpers ──────────────────────────────────────────────────────
function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toPersonalSpaceResponse(space: {
  id: string;
  name: string;
  slug: string | null;
  owner_principal_id: string;
  kind: string;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: space.id,
    slug: space.slug || space.id,
    name: space.name,
    owner_principal_id: space.owner_principal_id,
    kind: space.kind,
    created_at: space.created_at,
    updated_at: space.updated_at,
  };
}

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .use('*', async (c, next) => {
    const user = c.get('user');
    if (user?.principal_kind && user.principal_kind !== 'user') {
      throw new AuthorizationError('/api/me is only available to human accounts');
    }
    await next();
  })
  .get('/', async (c) => {
    const user = c.get('user');
    return c.json(toUserResponse(user));
  })

  .get('/personal-space', async (c) => {
    const user = c.get('user');
    const personalSpace = await getOrCreatePersonalWorkspace(c.env, user.id);

    if (!personalSpace) {
      throw new NotFoundError('Personal space');
    }

    return c.json({ space: toPersonalSpaceResponse(personalSpace) });
  })

  // Get user settings (including setup state)
  .get('/settings', async (c) => {
    const user = c.get('user');

    const settings = await ensureUserSettings(c.env.DB, user.id);
    return c.json(formatUserSettingsResponse(settings));
  })

  // Update user settings
  .patch('/settings', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<{
      setup_completed?: boolean;
      auto_update_enabled?: boolean;
      private_account?: boolean;
      activity_visibility?: string;
    }>(c);

    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }

    if (body.private_account !== undefined && typeof body.private_account !== 'boolean') {
      throw new BadRequestError('private_account must be boolean');
    }

    let activityVisibility = body.activity_visibility;
    if (activityVisibility !== undefined) {
      if (typeof activityVisibility !== 'string') {
        throw new BadRequestError('activity_visibility must be string');
      }
      activityVisibility = activityVisibility.trim().toLowerCase();
      if (!['public', 'followers', 'private'].includes(activityVisibility)) {
        throw new BadRequestError('activity_visibility must be one of public|followers|private');
      }
    }

    const settings = await updateUserSettings(c.env.DB, user.id, {
      ...body,
      activity_visibility: activityVisibility,
    });
    return c.json(formatUserSettingsResponse(settings));
  })

  // Update username
  .patch('/username', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<{ username?: string }>(c);

    if (!body || typeof body.username !== 'string') {
      throw new BadRequestError('username is required');
    }

    const normalizedUsername = body.username.trim().replace(/^@+/, '').toLowerCase();
    const usernameError = validateUsername(normalizedUsername);
    if (usernameError) {
      throw new BadRequestError(usernameError);
    }

    if (normalizedUsername === user.username) {
      return c.json({ success: true, username: normalizedUsername });
    }

    const db = getDb(c.env.DB);
    const existingUser = await db.select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.slug, normalizedUsername), ne(accounts.id, user.id)))
      .limit(1)
      .get();

    if (existingUser) {
      throw new ConflictError('This username is already taken');
    }
    await db.update(accounts).set({
      slug: normalizedUsername,
      updatedAt: new Date().toISOString(),
    }).where(eq(accounts.id, user.id));

    return c.json({ success: true, username: normalizedUsername });
  })

  .get('/oauth/consents', async (c) => {
    const user = c.get('user');
    const consents = await getUserConsentsWithClients(c.env.DB, user.id);

    return c.json({
      consents: consents.map(consent => ({
        client_id: consent.client_id,
        client_name: consent.client_name,
        client_logo: consent.client_logo,
        client_uri: consent.client_uri,
        scopes: parseJsonStringArray(consent.scopes),
        granted_at: consent.granted_at,
        updated_at: consent.updated_at,
      })),
    });
  })

  .delete('/oauth/consents/:clientId', async (c) => {
    const user = c.get('user');
    const clientId = c.req.param('clientId');
    const db = getDb(c.env.DB);

    await db.update(oauthTokens).set({
      revoked: true,
      revokedAt: new Date().toISOString(),
      revokedReason: 'user_revoked',
    }).where(and(eq(oauthTokens.accountId, user.id), eq(oauthTokens.clientId, clientId)));

    const success = await revokeConsent(c.env.DB, user.id, clientId);

    if (!success) {
      throw new NotFoundError('Consent');
    }

    try {
      await logOAuthEvent(c.env.DB, {
        userId: user.id,
        clientId,
        eventType: 'consent_revoked',
        details: { source: 'user' },
      });
    } catch (err) {
      logWarn('OAuth audit log failed', { action: 'oauth_audit_log', userId: user.id, clientId, error: String(err) });
    }

    return c.json({ success: true });
  })

  .get('/oauth/audit-logs', async (c) => {
    const user = c.get('user');
    const { limit, offset } = parsePagination(c.req.query(), { limit: 50, maxLimit: 100 });
    const clientId = c.req.query('client_id') || null;
    const db = getDb(c.env.DB);

    const conditions = [eq(oauthAuditLogs.accountId, user.id)];
    if (clientId) {
      conditions.push(eq(oauthAuditLogs.clientId, clientId));
    }

    const logs = await db.select().from(oauthAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(oauthAuditLogs.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    return c.json({
      logs: logs.map((log) => ({
        client_id: log.clientId,
        event_type: log.eventType,
        ip_address: log.ipAddress,
        user_agent: log.userAgent,
        details: safeJsonParseOrDefault<Record<string, unknown>>(log.details, {}),
        created_at: log.createdAt,
      })),
    });
  })

  .get('/oauth/clients', async (c) => {
    const user = c.get('user');
    const clients = await getClientsByOwner(c.env.DB, user.id);

    return c.json({
      clients: clients.map(client => ({
        client_id: client.client_id,
        name: client.name,
        description: client.description,
        logo_uri: client.logo_uri,
        client_uri: client.client_uri,
        redirect_uris: parseJsonStringArray(client.redirect_uris),
        allowed_scopes: parseJsonStringArray(client.allowed_scopes),
        client_type: client.client_type,
        status: client.status,
        created_at: client.created_at,
        updated_at: client.updated_at,
      })),
    });
  })

  .post('/oauth/clients', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<ClientRegistrationRequest>(c);

    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }

    if (!body.client_name) {
      throw new BadRequestError('client_name is required');
    }
    if (!body.redirect_uris || body.redirect_uris.length === 0) {
      throw new BadRequestError('redirect_uris is required');
    }

    try {
      const response = await createClient(c.env.DB, body, user.id);
      return c.json(response, 201);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Failed to create client');
    }
  })

  .patch('/oauth/clients/:clientId', async (c) => {
    const user = c.get('user');
    const clientId = c.req.param('clientId');
    const body = await parseJsonBody<Partial<ClientRegistrationRequest>>(c);

    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }

    const clients = await getClientsByOwner(c.env.DB, user.id);
    const ownedClient = clients.find(cl => cl.client_id === clientId);
    if (!ownedClient) {
      throw new NotFoundError('Client');
    }

    try {
      const updated = await updateClient(c.env.DB, clientId, body);
      if (!updated) {
        throw new NotFoundError('Client');
      }
      return c.json({
        id: updated.id,
        client_id: updated.client_id,
        name: updated.name,
        description: updated.description,
        logo_uri: updated.logo_uri,
        client_uri: updated.client_uri,
        redirect_uris: parseJsonStringArray(updated.redirect_uris),
        allowed_scopes: parseJsonStringArray(updated.allowed_scopes),
        status: updated.status,
      });
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Failed to update client');
    }
  })

  .delete('/oauth/clients/:clientId', async (c) => {
    const user = c.get('user');
    const clientId = c.req.param('clientId');

    const clients = await getClientsByOwner(c.env.DB, user.id);
    const ownedClient = clients.find(cl => cl.client_id === clientId);
    if (!ownedClient) {
      throw new NotFoundError('Client');
    }

    const success = await deleteClient(c.env.DB, clientId);
    if (!success) {
      throw new InternalError('Failed to delete client');
    }

    return c.json({ success: true });
  })

  .get('/personal-access-tokens', async (c) => {
    const user = c.get('user');
    const db = getDb(c.env.DB);
    const rows = await db.select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      tokenPrefix: personalAccessTokens.tokenPrefix,
      scopes: personalAccessTokens.scopes,
      expiresAt: personalAccessTokens.expiresAt,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      createdAt: personalAccessTokens.createdAt,
    }).from(personalAccessTokens)
      .where(eq(personalAccessTokens.accountId, user.id))
      .orderBy(desc(personalAccessTokens.createdAt))
      .all();
    const tokens = rows.map((t) => ({
      id: t.id,
      name: t.name,
      token_prefix: t.tokenPrefix,
      scopes: t.scopes,
      expires_at: t.expiresAt,
      last_used_at: t.lastUsedAt,
      created_at: t.createdAt,
    }));
    return c.json({ tokens });
  })

  .post('/personal-access-tokens', async (c) => {
    const user = c.get('user');
    const body = await parseJsonBody<{ name: string; scopes?: string; expiresAt?: string }>(c);
    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }
    if (!body.name?.trim()) {
      throw new BadRequestError('name is required');
    }

    const tokenBytes = generateRandomBytes(32);
    const tokenPlain = `tak_pat_${base64UrlEncode(tokenBytes)}`;
    const tokenHash = await computeSHA256(tokenPlain);
    const tokenPrefix = tokenPlain.substring(0, 12);

    const id = generateId();
    const timestamp = new Date().toISOString();
    const scopes = body.scopes ?? '*';

    let expiresAt: string | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (!isNaN(d.getTime())) {
        expiresAt = d.toISOString();
      }
    }

    const db = getDb(c.env.DB);
    await db.insert(personalAccessTokens).values({
      id,
      accountId: user.id,
      name: body.name.trim(),
      tokenHash,
      tokenPrefix,
      scopes,
      expiresAt,
      createdAt: timestamp,
    });

    return c.json({ id, name: body.name.trim(), token: tokenPlain, token_prefix: tokenPrefix, scopes, expires_at: expiresAt, created_at: timestamp }, 201);
  })

  .delete('/personal-access-tokens/:id', async (c) => {
    const user = c.get('user');
    const tokenId = c.req.param('id');

    const db = getDb(c.env.DB);
    const token = await db.select().from(personalAccessTokens).where(
      and(eq(personalAccessTokens.id, tokenId), eq(personalAccessTokens.accountId, user.id))
    ).get();

    if (!token) {
      throw new NotFoundError('Token');
    }

    await db.delete(personalAccessTokens).where(eq(personalAccessTokens.id, tokenId));
    return c.json({ success: true });
  });
