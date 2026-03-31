import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthorizationRequest } from '../../../shared/types/oauth.ts';
import { parseScopes, getScopeSummary } from '../../../application/services/oauth/scopes.ts';
import { validateAuthorizationRequest, generateAuthorizationCode, buildErrorRedirect, buildSuccessRedirect } from '../../../application/services/oauth/authorization.ts';
import { hasFullConsent, getNewScopes, grantConsent } from '../../../application/services/oauth/consent.ts';
import { getSession, getSessionIdFromCookie } from '../../../application/services/identity/session.ts';
import type { PublicRouteEnv } from '../route-auth.ts';
import { escapeHtml, isValidLogoUrl, tryLogOAuthEvent, getBodyValue, mapDbUser } from './request-utils.ts';
import { RateLimiters } from '../../../shared/utils/rate-limiter.ts';
import { getDb } from '../../../infra/db/index.ts';
import { accounts } from '../../../infra/db/schema.ts';
import { eq } from 'drizzle-orm';
import { consentPage } from '../auth/html.ts';
import { serveSpaFallback } from '../../../shared/utils/spa-fallback.ts';
import { getPlatformServices } from '../../../platform/accessors.ts';

const oauthAuthorize = new Hono<PublicRouteEnv>();

// Apply rate limiting: 30 requests per minute per IP
const authorizeRateLimiter = RateLimiters.oauthAuthorize();
oauthAuthorize.use('/authorize', authorizeRateLimiter.middleware());

// CSRF protection is handled by SameSite=Strict session cookie.
// Cross-site POST requests will not include the session cookie,
// so unauthenticated requests will be rejected at session validation.

/** Load and validate the current user from session cookie, returning null on failure. */
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

function getFormTextValue(
  value: string | File | Array<string | File> | undefined,
): string | undefined {
  if (value instanceof File) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const firstTextValue = value.find((entry): entry is string => typeof entry === 'string');
    return getBodyValue(firstTextValue);
  }
  return getBodyValue(value);
}

oauthAuthorize.get('/authorize', async (c) => {
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
    const validationError = validation.error ?? 'invalid_request';
    if (!validation.redirectUri || !query.state) {
      return c.json(
        {
          error: validationError,
          error_description: validation.errorDescription,
        },
        400
      );
    }

    const errorUrl = buildErrorRedirect(
      validation.redirectUri,
      query.state,
      validationError,
      validation.errorDescription
    );
    return c.redirect(errorUrl);
  }

  const client = validation.client;
  if (!client) {
    return c.json({ error: 'server_error', error_description: 'Validation succeeded but client is missing' }, 500);
  }

  const user = await loadSessionUser(c);
  if (!user) {
    const returnUrl = `/oauth/authorize?${new URLSearchParams(query).toString()}`;
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnUrl)}`);
  }

  // After successful validation, these fields are guaranteed present by validateAuthorizationRequest
  const validatedScope = request.scope;
  const validatedRedirectUri = request.redirect_uri;
  const validatedCodeChallenge = request.code_challenge;
  const validatedCodeChallengeMethod = request.code_challenge_method;
  const validatedState = request.state;
  if (!validatedScope || !validatedRedirectUri || !validatedCodeChallenge || !validatedCodeChallengeMethod || !validatedState) {
    return c.json({ error: 'server_error', error_description: 'Validation succeeded but required fields are missing' }, 500);
  }

  const requestedScopes = parseScopes(validatedScope);

  const hasConsent = await hasFullConsent(
    c.env.DB,
    user.id,
    client.client_id,
    requestedScopes
  );

  if (hasConsent) {
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
      details: {
        scope: validatedScope,
        redirect_uri: validatedRedirectUri,
      },
    });

    const successUrl = buildSuccessRedirect(
      validatedRedirectUri,
      validatedState,
      code
    );
    return c.redirect(successUrl);
  }

  // Try to serve the React SPA for the consent UI.
  // Falls back to server-rendered HTML if ASSETS is unavailable.
  const spaResponse = await serveSpaFallback(c.env, c.req.url);
  if (spaResponse) {
    return spaResponse;
  }

  // Fallback: server-rendered HTML consent page
  const newScopes = await getNewScopes(
    c.env.DB,
    user.id,
    client.client_id,
    requestedScopes
  );
  const scopeSummary = getScopeSummary(newScopes);

  const escapedClientName = escapeHtml(client.name);
  const escapedEmail = escapeHtml(user.email ?? '');
  const validLogoUri = isValidLogoUrl(client.logo_uri) ? escapeHtml(client.logo_uri!) : null;

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', `__Host-csrf=${csrfToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`);

  return c.html(consentPage({
    clientName: escapedClientName,
    clientLogoUri: validLogoUri,
    userEmail: escapedEmail,
    identityScopes: scopeSummary.identity.map((s) => escapeHtml(s)),
    resourceScopes: scopeSummary.resources.map((s) => escapeHtml(s)),
    hiddenFields: {
      client_id: escapeHtml(client.client_id),
      redirect_uri: escapeHtml(validatedRedirectUri),
      scope: escapeHtml(validatedScope),
      state: escapeHtml(validatedState),
      code_challenge: escapeHtml(validatedCodeChallenge),
      code_challenge_method: escapeHtml(validatedCodeChallengeMethod),
      csrf_token: csrfToken,
    },
  }));
});

oauthAuthorize.post('/authorize', async (c) => {
  const body = await c.req.parseBody();

  const authorizationRequest: Partial<AuthorizationRequest> = {
    response_type: 'code',
    client_id: getFormTextValue(body.client_id),
    redirect_uri: getFormTextValue(body.redirect_uri),
    scope: getFormTextValue(body.scope),
    state: getFormTextValue(body.state),
    code_challenge: getFormTextValue(body.code_challenge),
    code_challenge_method: getFormTextValue(body.code_challenge_method) as AuthorizationRequest['code_challenge_method'] | undefined,
  };
  const action = getFormTextValue(body.action);

  // CSRF protection: validate token from hidden field matches cookie
  const csrfFromBody = getFormTextValue(body.csrf_token);
  const csrfCookie = c.req.header('Cookie')?.match(/__Host-csrf=([^;]+)/)?.[1];
  if (!csrfFromBody || !csrfCookie || csrfFromBody !== csrfCookie) {
    return c.json({ error: 'CSRF token mismatch' }, 403);
  }

  const user = await loadSessionUser(c);
  if (!user) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const validation = await validateAuthorizationRequest(c.env.DB, authorizationRequest);
  if (!validation.valid) {
    const oauthError = validation.error ?? 'invalid_request';
    const oauthErrorDescription = validation.errorDescription ?? 'Invalid authorization request';

    if (validation.redirectUri && authorizationRequest.state) {
      const errorUrl = buildErrorRedirect(
        validation.redirectUri,
        authorizationRequest.state,
        oauthError,
        oauthErrorDescription
      );
      return c.redirect(errorUrl);
    }

    return c.json(
      {
        error: oauthError,
        error_description: oauthErrorDescription,
      },
      400
    );
  }

  const postClient = validation.client;
  const postRedirectUri = validation.redirectUri;
  const postScope = authorizationRequest.scope;
  const postState = authorizationRequest.state;
  const postCodeChallenge = authorizationRequest.code_challenge;
  const postCodeChallengeMethod = authorizationRequest.code_challenge_method;
  if (!postClient || !postRedirectUri || !postScope || !postState || !postCodeChallenge || !postCodeChallengeMethod) {
    return c.json({ error: 'server_error', error_description: 'Validation succeeded but required fields are missing' }, 500);
  }

  const normalizedRequest: AuthorizationRequest = {
    response_type: 'code',
    client_id: postClient.client_id,
    redirect_uri: postRedirectUri,
    scope: postScope,
    state: postState,
    code_challenge: postCodeChallenge,
    code_challenge_method: postCodeChallengeMethod,
  };

  if (action === 'deny') {
    await tryLogOAuthEvent(c, {
      userId: user.id,
      clientId: normalizedRequest.client_id,
      eventType: 'authorize_denied',
      details: {
        scope: normalizedRequest.scope,
        redirect_uri: normalizedRequest.redirect_uri,
      },
    });
    const errorUrl = buildErrorRedirect(
      normalizedRequest.redirect_uri,
      normalizedRequest.state,
      'access_denied',
      'User denied the request'
    );
    return c.redirect(errorUrl);
  }

  const scopes = parseScopes(normalizedRequest.scope);
  await grantConsent(c.env.DB, user.id, normalizedRequest.client_id, scopes);

  await tryLogOAuthEvent(c, {
    userId: user.id,
    clientId: normalizedRequest.client_id,
    eventType: 'consent_granted',
    details: { scope: normalizedRequest.scope },
  });

  const code = await generateAuthorizationCode(c.env.DB, {
    clientId: normalizedRequest.client_id,
    userId: user.id,
    redirectUri: normalizedRequest.redirect_uri,
    scope: normalizedRequest.scope,
    codeChallenge: normalizedRequest.code_challenge,
    codeChallengeMethod: normalizedRequest.code_challenge_method,
  });

  const successUrl = buildSuccessRedirect(
    normalizedRequest.redirect_uri,
    normalizedRequest.state,
    code
  );
  return c.redirect(successUrl);
});

export default oauthAuthorize;
