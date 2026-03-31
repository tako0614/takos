import { Hono } from 'hono';
import type { Context } from 'hono';
import type { DeviceAuthorizationResponse } from '../../../shared/types/oauth.ts';
import { DEVICE_CODE_GRANT_TYPE } from '../../../shared/types/oauth.ts';
import { parseScopes, validateScopes, areScopesAllowed, getScopeSummary } from '../../../application/services/oauth/scopes.ts';
import { validateClientCredentials, supportsGrantType, getClientAllowedScopes, getClientById } from '../../../application/services/oauth/client.ts';
import {
  createDeviceAuthorization,
  getDeviceAuthorizationByUserCode,
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  normalizeUserCode,
} from '../../../application/services/oauth/device.ts';
import { hasFullConsent, getNewScopes, grantConsent } from '../../../application/services/oauth/consent.ts';
import { getSession, getSessionIdFromCookie } from '../../../application/services/identity/session.ts';
import { getDb } from '../../../infra/db/index.ts';
import { accounts } from '../../../infra/db/schema.ts';
import { eq } from 'drizzle-orm';
import type { PublicRouteEnv } from '../route-auth.ts';
import { escapeHtml, isValidLogoUrl, tryLogOAuthEvent, getBodyValue, mapDbUser, type FormBody } from './request-utils.ts';
import { RateLimiters } from '../../../shared/utils/rate-limiter.ts';
import {
  isDeviceUserCodeLimited,
  recordDeviceUserCodeAttempt,
  clearDeviceUserCodeAttempts,
} from '../../../application/services/oauth/device-auth-rate-limit.ts';
import { deviceCodeEntryPage, deviceConsentPage, deviceResultPage, errorPage } from '../auth/html.ts';
import { serveSpaFallback } from '../../../shared/utils/spa-fallback.ts';
import { getPlatformServices } from '../../../platform/accessors.ts';

const oauthDevice = new Hono<PublicRouteEnv>();

const deviceCodeRateLimiter = RateLimiters.oauthDeviceCode();
oauthDevice.use('/device/code', deviceCodeRateLimiter.middleware());

const deviceVerifyRateLimiter = RateLimiters.oauthDeviceVerify();
oauthDevice.use('/device', deviceVerifyRateLimiter.middleware());

async function loadSessionUser(c: Context<PublicRouteEnv>) {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);
  if (!sessionId) return null;

  const services = getPlatformServices(c);
  const sessionStore = services.notifications.sessionStore;
  const dbBinding = services.sql?.binding;
  if (!sessionStore || !dbBinding) return null;

  const session = await getSession(sessionStore, sessionId);
  if (!session) return null;

  const db = getDb(dbBinding);
  const userData = await db.select().from(accounts).where(eq(accounts.id, session.user_id)).get();
  if (!userData) return null;

  return mapDbUser(userData);
}

oauthDevice.post('/device/code', async (c) => {
  const contentType = c.req.header('Content-Type');
  if (!contentType?.includes('application/x-www-form-urlencoded')) {
    return c.json(
      { error: 'invalid_request', error_description: 'Content-Type must be application/x-www-form-urlencoded' },
      400
    );
  }

  const body = (await c.req.parseBody()) as FormBody;
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);
  const scope = getBodyValue(body.scope);

  if (!clientId || !scope) {
    return c.json(
      { error: 'invalid_request', error_description: 'client_id and scope are required' },
      400
    );
  }

  const { valid, client, error } = await validateClientCredentials(c.env.DB, clientId, clientSecret);
  if (!valid || !client) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }

  if (!supportsGrantType(client, DEVICE_CODE_GRANT_TYPE)) {
    return c.json(
      { error: 'unauthorized_client', error_description: 'Client does not support device_code grant' },
      400
    );
  }

  const requestedScopes = parseScopes(scope);
  const { valid: scopesValid, unknown } = validateScopes(requestedScopes);
  if (!scopesValid) {
    return c.json(
      { error: 'invalid_scope', error_description: `Unknown scopes: ${unknown.join(', ')}` },
      400
    );
  }

  const allowedScopes = getClientAllowedScopes(client);
  if (!areScopesAllowed(requestedScopes, allowedScopes)) {
    return c.json(
      { error: 'invalid_scope', error_description: 'Requested scope exceeds allowed scopes' },
      400
    );
  }

  const created = await createDeviceAuthorization(c.env.DB, {
    clientId,
    scope,
  });

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  const verificationUri = `${issuer}/oauth/device`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(created.userCode)}`;

  const response: DeviceAuthorizationResponse = {
    device_code: created.deviceCode,
    user_code: created.userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: created.expiresIn,
    interval: created.interval,
  };

  await tryLogOAuthEvent(c, {
    userId: null,
    clientId,
    eventType: 'device_code_issued',
    details: {
      scope,
      expires_at: created.expiresAt,
      interval: created.interval,
    },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

oauthDevice.get('/device', async (c) => {
  const url = new URL(c.req.url);
  const rawUserCode = url.searchParams.get('user_code');

  const user = await loadSessionUser(c);
  if (!user) {
    const returnUrl = `${url.pathname}${url.search}`;
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnUrl)}`);
  }

  // Try to serve the React SPA for the device auth UI.
  // Falls back to server-rendered HTML if ASSETS is unavailable.
  const spaResponse = await serveSpaFallback(c.env, c.req.url);
  if (spaResponse) {
    return spaResponse;
  }

  // Fallback: server-rendered HTML
  if (!rawUserCode) {
    return c.html(deviceCodeEntryPage({
      userEmail: escapeHtml(user.email ?? ''),
      presetUserCode: null,
      message: null,
    }));
  }

  const normalizedUserCode = normalizeUserCode(rawUserCode);
  if (!normalizedUserCode) {
    return c.html(deviceCodeEntryPage({
      userEmail: escapeHtml(user.email ?? ''),
      presetUserCode: escapeHtml(rawUserCode),
      message: '\u30b3\u30fc\u30c9\u304c\u7121\u52b9\u3067\u3059\u3002',
    }));
  }
  if (isDeviceUserCodeLimited(normalizedUserCode)) {
    return c.html(deviceResultPage({ title: '\u5236\u9650', message: '\u3053\u306e\u30b3\u30fc\u30c9\u3078\u306e\u8a66\u884c\u56de\u6570\u304c\u4e0a\u9650\u306b\u9054\u3057\u307e\u3057\u305f\u3002' }));
  }

  const deviceAuth = await getDeviceAuthorizationByUserCode(c.env.DB, normalizedUserCode);
  if (!deviceAuth) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceCodeEntryPage({
      userEmail: escapeHtml(user.email ?? ''),
      presetUserCode: escapeHtml(rawUserCode),
      message: '\u30b3\u30fc\u30c9\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002',
    }));
  }

  if (new Date(deviceAuth.expires_at) < new Date()) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceCodeEntryPage({
      userEmail: escapeHtml(user.email ?? ''),
      presetUserCode: escapeHtml(rawUserCode),
      message: '\u3053\u306e\u30b3\u30fc\u30c9\u306f\u671f\u9650\u5207\u308c\u3067\u3059\u3002',
    }));
  }

  if (deviceAuth.status === 'denied') {
    return c.html(deviceResultPage({ title: '\u62d2\u5426\u3057\u307e\u3057\u305f', message: '\u3053\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u306f\u62d2\u5426\u3055\u308c\u3066\u3044\u307e\u3059\u3002' }));
  }
  if (deviceAuth.status === 'used') {
    return c.html(deviceResultPage({ title: '\u5b8c\u4e86\u6e08\u307f', message: '\u3053\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u306f\u65e2\u306b\u5b8c\u4e86\u3057\u3066\u3044\u307e\u3059\u3002' }));
  }
  if (deviceAuth.status === 'approved') {
    return c.html(deviceResultPage({ title: '\u627f\u8a8d\u6e08\u307f', message: '\u627f\u8a8d\u6e08\u307f\u3067\u3059\u3002\u30c7\u30d0\u30a4\u30b9\u5074\u306b\u623b\u3063\u3066\u304f\u3060\u3055\u3044\u3002' }));
  }
  if (deviceAuth.status !== 'pending') {
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u3053\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u306f\u7121\u52b9\u3067\u3059\u3002' }));
  }

  const client = await getClientById(c.env.DB, deviceAuth.client_id);
  if (!client) {
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u30af\u30e9\u30a4\u30a2\u30f3\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002' }));
  }

  const requestedScopes = parseScopes(deviceAuth.scope);
  const hasConsent = await hasFullConsent(c.env.DB, user.id, client.client_id, requestedScopes);

  if (hasConsent) {
    const ok = await approveDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
    if (!ok) {
      return c.html(deviceResultPage({ title: '\u30a8\u30e9\u30fc', message: '\u627f\u8a8d\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002' }));
    }

    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'device_auto_approved',
      details: { scope: deviceAuth.scope },
    });

    return c.html(deviceResultPage({ title: '\u627f\u8a8d\u3057\u307e\u3057\u305f', message: '\u30c7\u30d0\u30a4\u30b9\u5074\u306b\u623b\u3063\u3066\u304f\u3060\u3055\u3044\u3002' }));
  }

  const newScopes = await getNewScopes(c.env.DB, user.id, client.client_id, requestedScopes);
  const scopeSummary = getScopeSummary(newScopes);

  const escapedClientName = escapeHtml(client.name);
  const validLogoUri = isValidLogoUrl(client.logo_uri) ? escapeHtml(client.logo_uri!) : null;
  const escapedUserCode = escapeHtml(rawUserCode);

  // CSRF double-submit cookie — mirrors the authorize flow's __Host-csrf pattern
  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', `__Host-csrf=${csrfToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);

  return c.html(deviceConsentPage({
    clientName: escapedClientName,
    clientLogoUri: validLogoUri,
    userEmail: escapeHtml(user.email ?? ''),
    userCode: escapedUserCode,
    csrfToken,
    identityScopes: scopeSummary.identity.map((s) => escapeHtml(s)),
    resourceScopes: scopeSummary.resources.map((s) => escapeHtml(s)),
  }));
});

oauthDevice.post('/device', async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const rawUserCode = getBodyValue(body.user_code) || '';
  const action = getBodyValue(body.action);
  const normalizedUserCode = normalizeUserCode(rawUserCode);

  // CSRF double-submit validation — cookie vs hidden field
  const csrfFromBody = getBodyValue(body.csrf_token);
  const csrfCookie = c.req.header('Cookie')?.match(/__Host-csrf=([^;]+)/)?.[1];
  if (!csrfFromBody || !csrfCookie || csrfFromBody !== csrfCookie) {
    return c.json({ error: 'CSRF token mismatch' }, 403);
  }

  if (!rawUserCode || (action !== 'allow' && action !== 'deny')) {
    return c.html(errorPage('\u7121\u52b9\u306a\u30ea\u30af\u30a8\u30b9\u30c8', 'user_code \u3068 action \u304c\u5fc5\u8981\u3067\u3059\u3002', '/oauth/device', '\u623b\u308b'));
  }
  if (!normalizedUserCode) {
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u30b3\u30fc\u30c9\u5f62\u5f0f\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u3002' }));
  }
  if (isDeviceUserCodeLimited(normalizedUserCode)) {
    return c.html(deviceResultPage({ title: '\u5236\u9650', message: '\u3053\u306e\u30b3\u30fc\u30c9\u3078\u306e\u8a66\u884c\u56de\u6570\u304c\u4e0a\u9650\u306b\u9054\u3057\u307e\u3057\u305f\u3002' }));
  }

  const user = await loadSessionUser(c);
  if (!user) {
    const returnUrl = `/oauth/device?user_code=${encodeURIComponent(rawUserCode)}`;
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnUrl)}`);
  }

  const deviceAuth = await getDeviceAuthorizationByUserCode(c.env.DB, normalizedUserCode);
  if (!deviceAuth) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u30b3\u30fc\u30c9\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002' }));
  }

  if (new Date(deviceAuth.expires_at) < new Date()) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceResultPage({ title: '\u671f\u9650\u5207\u308c', message: '\u3053\u306e\u30b3\u30fc\u30c9\u306f\u671f\u9650\u5207\u308c\u3067\u3059\u3002' }));
  }

  if (deviceAuth.status !== 'pending') {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u3053\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u306f\u65e2\u306b\u51e6\u7406\u6e08\u307f\u3067\u3059\u3002' }));
  }

  const client = await getClientById(c.env.DB, deviceAuth.client_id);
  if (!client) {
    return c.html(deviceResultPage({ title: '\u7121\u52b9', message: '\u30af\u30e9\u30a4\u30a2\u30f3\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002' }));
  }

  const requestedScopes = parseScopes(deviceAuth.scope);

  if (action === 'deny') {
    const ok = await denyDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
    if (!ok) {
      recordDeviceUserCodeAttempt(normalizedUserCode);
      return c.html(deviceResultPage({ title: '\u30a8\u30e9\u30fc', message: '\u62d2\u5426\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002' }));
    }
    clearDeviceUserCodeAttempts(normalizedUserCode);

    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: client.client_id,
      eventType: 'device_denied',
      details: { scope: deviceAuth.scope },
    });

    return c.html(deviceResultPage({ title: '\u62d2\u5426\u3057\u307e\u3057\u305f', message: '\u30c7\u30d0\u30a4\u30b9\u5074\u306b\u623b\u3063\u3066\u304f\u3060\u3055\u3044\u3002' }));
  }

  await grantConsent(c.env.DB, user.id, client.client_id, requestedScopes);
  const ok = await approveDeviceAuthorization(c.env.DB, { id: deviceAuth.id, userId: user.id });
  if (!ok) {
    recordDeviceUserCodeAttempt(normalizedUserCode);
    return c.html(deviceResultPage({ title: '\u30a8\u30e9\u30fc', message: '\u627f\u8a8d\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002' }));
  }
  clearDeviceUserCodeAttempts(normalizedUserCode);

  await tryLogOAuthEvent(c, {
    userId: user.id,
    clientId: client.client_id,
    eventType: 'device_approved',
    details: { scope: deviceAuth.scope },
  });

  return c.html(deviceResultPage({ title: '\u627f\u8a8d\u3057\u307e\u3057\u305f', message: '\u30c7\u30d0\u30a4\u30b9\u5074\u306b\u623b\u3063\u3066\u304f\u3060\u3055\u3044\u3002' }));
});

export default oauthDevice;
