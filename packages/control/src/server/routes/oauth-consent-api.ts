/**
 * JSON API endpoints for OAuth consent UI (consumed by the React SPA).
 *
 * Mounted at /api/oauth — separate from the existing /oauth routes which
 * handle protocol-level OAuth2 endpoints.
 */

import { Hono, type Context } from 'hono';
import type { User } from '../../shared/types';
import type { AuthorizationRequest } from '../../shared/types/oauth';
import { parseScopes, getScopeSummary } from '../../application/services/oauth/scopes';
import {
  validateAuthorizationRequest,
  generateAuthorizationCode,
  buildErrorRedirect,
  buildSuccessRedirect,
} from '../../application/services/oauth/authorization';
import { hasFullConsent, getNewScopes, grantConsent } from '../../application/services/oauth/consent';
import { getSession, getSessionIdFromCookie } from '../../application/services/identity/session';
import { getDb } from '../../infra/db';
import { accounts } from '../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { isValidLogoUrl, mapDbUser, tryLogOAuthEvent } from './oauth/request-utils';
import {
  getDeviceAuthorizationByUserCode,
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  normalizeUserCode,
} from '../../application/services/oauth/device';
import { getClientById } from '../../application/services/oauth/client';
import { AuthorizationError, AuthenticationError } from '@takos/common/errors';
import {
  isDeviceUserCodeLimited,
  recordDeviceUserCodeAttempt,
  clearDeviceUserCodeAttempts,
} from '../../shared/utils/device-auth-rate-limit';
import type { PublicRouteEnv } from './shared/route-auth';
import { getPlatformSessionStore, getPlatformSqlBinding } from '../../platform/accessors.ts';

type ConsentApiEnv = { Bindings: PublicRouteEnv['Bindings']; Variables: { user?: User } };

const oauthConsentApi = new Hono<ConsentApiEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSessionUser(c: Context<ConsentApiEnv>) {
  const sessionStore = getPlatformSessionStore(c);
  const dbBinding = getPlatformSqlBinding(c);
  if (!sessionStore || !dbBinding) return null;

  const cookieHeader = c.req.header('Cookie');
  const sessionId = getSessionIdFromCookie(cookieHeader ?? null);
  if (!sessionId) return null;

  const session = await getSession(sessionStore, sessionId);
  if (!session) return null;

  const db = getDb(dbBinding);
  const userData = await db.select().from(accounts).where(eq(accounts.id, session.user_id)).get();
  if (!userData) return null;

  return mapDbUser(userData);
}

// ---------------------------------------------------------------------------
// GET /api/oauth/authorize/context
// ---------------------------------------------------------------------------

oauthConsentApi.get('/authorize/context', async (c) => {
  const query = c.req.query();

  const request: Partial<AuthorizationRequest> = {
    response_type: query.response_type as 'code',
    client_id: query.client_id,
    redirect_uri: query.redirect_uri,
    scope: query.scope,
    state: query.state,
    code_challenge: query.code_challenge,
    code_challenge_method: query.code_challenge_method as 'S256',
  };

  const validation = await validateAuthorizationRequest(c.env.DB, request);

  if (!validation.valid) {
    const errorCode = validation.error ?? 'invalid_request';
    if (validation.redirectUri && query.state) {
      return c.json({
        status: 'error_redirect' as const,
        redirect_url: buildErrorRedirect(validation.redirectUri, query.state, errorCode, validation.errorDescription),
      });
    }
    return c.json({ error: errorCode, error_description: validation.errorDescription }, 400);
  }

  const client = validation.client;
  if (!client) {
    return c.json({ error: 'server_error', error_description: 'Client missing after validation' }, 500);
  }

  const user = await loadSessionUser(c);
  if (!user) {
    return c.json({ status: 'unauthenticated' as const }, 401);
  }

  const validatedScope = request.scope!;
  const validatedRedirectUri = request.redirect_uri!;
  const validatedCodeChallenge = request.code_challenge!;
  const validatedCodeChallengeMethod = request.code_challenge_method!;
  const validatedState = request.state!;

  const requestedScopes = parseScopes(validatedScope);

  // Auto-approve if user has already consented
  const alreadyConsented = await hasFullConsent(c.env.DB, user.id, client.client_id, requestedScopes);
  if (alreadyConsented) {
    const code = await generateAuthorizationCode(c.env.DB, {
      clientId: client.client_id,
      userId: user.id,
      redirectUri: validatedRedirectUri,
      scope: validatedScope,
      codeChallenge: validatedCodeChallenge,
      codeChallengeMethod: validatedCodeChallengeMethod,
    });

    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'authorize_auto_approved',
      details: { scope: validatedScope, redirect_uri: validatedRedirectUri },
    });

    return c.json({
      status: 'auto_approved' as const,
      redirect_url: buildSuccessRedirect(validatedRedirectUri, validatedState, code),
    });
  }

  // Consent required — return context for the React UI
  const newScopes = await getNewScopes(c.env.DB, user.id, client.client_id, requestedScopes);
  const scopeSummary = getScopeSummary(newScopes);

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', `__Host-csrf=${csrfToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);

  return c.json({
    status: 'consent_required' as const,
    client: {
      name: client.name,
      logo_uri: isValidLogoUrl(client.logo_uri) ? client.logo_uri : null,
    },
    user: { email: user.email },
    scopes: {
      identity: scopeSummary.identity,
      resources: scopeSummary.resources,
    },
    csrf_token: csrfToken,
    params: {
      client_id: client.client_id,
      redirect_uri: validatedRedirectUri,
      scope: validatedScope,
      state: validatedState,
      code_challenge: validatedCodeChallenge,
      code_challenge_method: validatedCodeChallengeMethod,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth/authorize/decision
// ---------------------------------------------------------------------------

oauthConsentApi.post('/authorize/decision', async (c) => {
  const body = await c.req.json<{
    action: string;
    csrf_token: string;
    client_id: string;
    redirect_uri: string;
    scope: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
  }>();

  // CSRF validation
  const csrfCookie = c.req.header('Cookie')?.match(/__Host-csrf=([^;]+)/)?.[1];
  if (!body.csrf_token || !csrfCookie || body.csrf_token !== csrfCookie) {
    throw new AuthorizationError('CSRF token mismatch');
  }

  const user = await loadSessionUser(c);
  if (!user) {
    throw new AuthenticationError('Not authenticated');
  }

  const authRequest: Partial<AuthorizationRequest> = {
    response_type: 'code',
    client_id: body.client_id,
    redirect_uri: body.redirect_uri,
    scope: body.scope,
    state: body.state,
    code_challenge: body.code_challenge,
    code_challenge_method: body.code_challenge_method as 'S256',
  };

  const validation = await validateAuthorizationRequest(c.env.DB, authRequest);
  if (!validation.valid) {
    const errorCode = validation.error ?? 'invalid_request';
    if (validation.redirectUri && body.state) {
      return c.json({
        redirect_url: buildErrorRedirect(validation.redirectUri, body.state, errorCode, validation.errorDescription),
      });
    }
    return c.json({ error: errorCode, error_description: validation.errorDescription }, 400);
  }

  const client = validation.client!;
  const redirectUri = validation.redirectUri!;

  if (body.action === 'deny') {
    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'authorize_denied',
      details: { scope: body.scope, redirect_uri: redirectUri },
    });
    return c.json({
      redirect_url: buildErrorRedirect(redirectUri, body.state, 'access_denied', 'User denied the request'),
    });
  }

  const scopes = parseScopes(body.scope);
  await grantConsent(c.env.DB, user.id, client.client_id, scopes);

  await tryLogOAuthEvent(c, {
    userId: user.id,
    clientId: client.client_id,
    eventType: 'consent_granted',
    details: { scope: body.scope },
  });

  const code = await generateAuthorizationCode(c.env.DB, {
    clientId: client.client_id,
    userId: user.id,
    redirectUri,
    scope: body.scope,
    codeChallenge: body.code_challenge,
    codeChallengeMethod: body.code_challenge_method as 'S256',
  });

  return c.json({
    redirect_url: buildSuccessRedirect(redirectUri, body.state, code),
  });
});

// ---------------------------------------------------------------------------
// GET /api/oauth/device/context
// ---------------------------------------------------------------------------

oauthConsentApi.get('/device/context', async (c) => {
  const rawUserCode = c.req.query('user_code');

  const user = await loadSessionUser(c);
  if (!user) {
    return c.json({ status: 'unauthenticated' as const }, 401);
  }

  if (!rawUserCode) {
    return c.json({
      status: 'code_entry' as const,
      user: { email: user.email },
    });
  }

  const normalizedUserCode = normalizeUserCode(rawUserCode);
  if (!normalizedUserCode) {
    return c.json({
      status: 'error' as const,
      title: 'Invalid',
      message: 'Code format is incorrect.',
    });
  }

  if (isDeviceUserCodeLimited(normalizedUserCode)) {
    return c.json({
      status: 'error' as const,
      title: 'Rate Limited',
      message: 'Too many attempts for this code.',
    });
  }

  const deviceAuth = await getDeviceAuthorizationByUserCode(c.env.DB, normalizedUserCode);
  if (!deviceAuth) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({
      status: 'error' as const,
      title: 'Not Found',
      message: 'Code not found.',
    });
  }

  if (new Date(deviceAuth.expires_at) < new Date()) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({
      status: 'error' as const,
      title: 'Expired',
      message: 'This code has expired.',
    });
  }

  if (deviceAuth.status === 'denied') {
    return c.json({ status: 'result' as const, title: 'Denied', message: 'This request was denied.' });
  }
  if (deviceAuth.status === 'used') {
    return c.json({ status: 'result' as const, title: 'Completed', message: 'This request is already completed.' });
  }
  if (deviceAuth.status === 'approved') {
    return c.json({ status: 'result' as const, title: 'Approved', message: 'Already approved. Return to your device.' });
  }
  if (deviceAuth.status !== 'pending') {
    return c.json({ status: 'error' as const, title: 'Invalid', message: 'This request is invalid.' });
  }

  const client = await getClientById(c.env.DB, deviceAuth.client_id);
  if (!client) {
    return c.json({ status: 'error' as const, title: 'Invalid', message: 'Client not found.' });
  }

  const requestedScopes = parseScopes(deviceAuth.scope);

  // Auto-approve if already consented
  const alreadyConsented = await hasFullConsent(c.env.DB, user.id, client.client_id, requestedScopes);
  if (alreadyConsented) {
    const ok = await approveDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
    if (!ok) {
      return c.json({ status: 'error' as const, title: 'Error', message: 'Approval failed.' });
    }

    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'device_auto_approved',
      details: { scope: deviceAuth.scope },
    });

    return c.json({
      status: 'auto_approved' as const,
      title: 'Approved',
      message: 'Return to your device.',
    });
  }

  // Consent required
  const newScopes = await getNewScopes(c.env.DB, user.id, client.client_id, requestedScopes);
  const scopeSummary = getScopeSummary(newScopes);

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', `__Host-csrf=${csrfToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);

  return c.json({
    status: 'consent_required' as const,
    client: {
      name: client.name,
      logo_uri: isValidLogoUrl(client.logo_uri) ? client.logo_uri : null,
    },
    user: { email: user.email },
    user_code: rawUserCode,
    scopes: {
      identity: scopeSummary.identity,
      resources: scopeSummary.resources,
    },
    csrf_token: csrfToken,
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth/device/decision
// ---------------------------------------------------------------------------

oauthConsentApi.post('/device/decision', async (c) => {
  const body = await c.req.json<{
    user_code: string;
    action: string;
    csrf_token: string;
  }>();

  // CSRF validation
  const csrfCookie = c.req.header('Cookie')?.match(/__Host-csrf=([^;]+)/)?.[1];
  if (!body.csrf_token || !csrfCookie || body.csrf_token !== csrfCookie) {
    throw new AuthorizationError('CSRF token mismatch');
  }

  const user = await loadSessionUser(c);
  if (!user) {
    throw new AuthenticationError('Not authenticated');
  }

  const normalizedUserCode = normalizeUserCode(body.user_code || '');
  if (!normalizedUserCode) {
    return c.json({ status: 'error' as const, title: 'Invalid', message: 'Code format is incorrect.' });
  }

  if (isDeviceUserCodeLimited(normalizedUserCode)) {
    return c.json({ status: 'error' as const, title: 'Rate Limited', message: 'Too many attempts for this code.' });
  }

  const deviceAuth = await getDeviceAuthorizationByUserCode(c.env.DB, normalizedUserCode);
  if (!deviceAuth) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({ status: 'error' as const, title: 'Not Found', message: 'Code not found.' });
  }

  if (new Date(deviceAuth.expires_at) < new Date()) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({ status: 'error' as const, title: 'Expired', message: 'This code has expired.' });
  }

  if (deviceAuth.status !== 'pending') {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({ status: 'error' as const, title: 'Invalid', message: 'This request is already processed.' });
  }

  const client = await getClientById(c.env.DB, deviceAuth.client_id);
  if (!client) {
    return c.json({ status: 'error' as const, title: 'Invalid', message: 'Client not found.' });
  }

  const requestedScopes = parseScopes(deviceAuth.scope);

  if (body.action === 'deny') {
    const ok = await denyDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
    if (!ok) {
      recordDeviceUserCodeAttempt(normalizedUserCode);
      return c.json({ status: 'error' as const, title: 'Error', message: 'Denial failed.' });
    }
    clearDeviceUserCodeAttempts(normalizedUserCode);

    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'device_denied',
      details: { scope: deviceAuth.scope },
    });

    return c.json({ status: 'denied' as const, title: 'Denied', message: 'Return to your device.' });
  }

  // Allow
  await grantConsent(c.env.DB, user.id, client.client_id, requestedScopes);
  const ok = await approveDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
  if (!ok) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.json({ status: 'error' as const, title: 'Error', message: 'Approval failed.' });
  }
  clearDeviceUserCodeAttempts(normalizedUserCode);

  await tryLogOAuthEvent(c, {
    userId: user.id,
    clientId: client.client_id,
    eventType: 'device_approved',
    details: { scope: deviceAuth.scope },
  });

  return c.json({ status: 'approved' as const, title: 'Approved', message: 'Return to your device.' });
});

export default oauthConsentApi;
