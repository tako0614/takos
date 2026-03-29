import { Hono } from 'hono';
import type { ClientRegistrationRequest } from '../../../shared/types/oauth';
import { parseJsonStringArray } from '../../../shared/types/oauth';
import { parseJsonBody } from '../route-auth';
import {
  createClient,
  deleteClient,
  getClientById,
  updateClient,
  validateRegistrationToken,
} from '../../../application/services/oauth/client';
import { isAccessTokenValid, verifyAccessToken } from '../../../application/services/oauth/token';
import { tryLogOAuthEvent } from './request-utils';
import type { PublicRouteEnv } from '../route-auth';
import { RateLimiters } from '../../../shared/utils/rate-limiter';

const oauthRegister = new Hono<PublicRouteEnv>();

// Apply rate limiting: 10 requests per minute per IP
const registerRateLimiter = RateLimiters.oauthRegister();
oauthRegister.use('/register', registerRateLimiter.middleware());
oauthRegister.use('/register/*', registerRateLimiter.middleware());

oauthRegister.post('/register', async (c) => {
  const postAuthHeader = c.req.header('Authorization');
  const bearerToken = postAuthHeader?.startsWith('Bearer ') ? postAuthHeader.slice(7).trim() || null : null;
  if (!bearerToken) {
    return c.json({ error: 'invalid_token', error_description: 'Bearer token required' }, 401);
  }

  const payload = await verifyAccessToken({
    token: bearerToken,
    publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
    issuer: `https://${c.env.ADMIN_DOMAIN}`,
  });
  if (!payload) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const active = await isAccessTokenValid(c.env.DB, payload.jti);
  if (!active) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const body = await parseJsonBody<ClientRegistrationRequest>(c);

  if (!body) {
    return c.json(
      { error: 'invalid_request', error_description: 'Invalid JSON body' },
      400
    );
  }

  if (!body.client_name || !body.redirect_uris || body.redirect_uris.length === 0) {
    return c.json(
      { error: 'invalid_client_metadata', error_description: 'client_name and redirect_uris are required' },
      400
    );
  }

  try {
    const ownerId = payload.sub;

    const response = await createClient(c.env.DB, body, ownerId);
    await tryLogOAuthEvent(c, {
      userId: ownerId || null,
      clientId: response.client_id,
      eventType: 'client_registered',
      details: {
        client_name: body.client_name,
      },
    });
    return c.json(response, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    return c.json({ error: 'invalid_client_metadata', error_description: message }, 400);
  }
});

oauthRegister.get('/register/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  const getAuthHeader = c.req.header('Authorization');
  const token = getAuthHeader?.startsWith('Bearer ') ? getAuthHeader.slice(7).trim() || null : null;

  if (!token) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const isValid = await validateRegistrationToken(c.env.DB, clientId, token);
  if (!isValid) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  return c.json({
    client_id: client.client_id,
    client_name: client.name,
    redirect_uris: parseJsonStringArray(client.redirect_uris),
    grant_types: parseJsonStringArray(client.grant_types),
    response_types: parseJsonStringArray(client.response_types),
    scope: parseJsonStringArray(client.allowed_scopes).join(' '),
    client_uri: client.client_uri,
    logo_uri: client.logo_uri,
    policy_uri: client.policy_uri,
    tos_uri: client.tos_uri,
  });
});

oauthRegister.put('/register/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  const putAuthHeader = c.req.header('Authorization');
  const token = putAuthHeader?.startsWith('Bearer ') ? putAuthHeader.slice(7).trim() || null : null;

  if (!token) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const isValid = await validateRegistrationToken(c.env.DB, clientId, token);
  if (!isValid) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const body = await parseJsonBody<Partial<ClientRegistrationRequest>>(c);

  if (!body) {
    return c.json(
      { error: 'invalid_request', error_description: 'Invalid JSON body' },
      400
    );
  }

  try {
    const updated = await updateClient(c.env.DB, clientId, body);
    if (!updated) {
      return c.json({ error: 'Client not found' }, 404);
    }

    await tryLogOAuthEvent(c, {
      userId: updated.owner_id || null,
      clientId: updated.client_id,
      eventType: 'client_updated',
    });

    return c.json({
      client_id: updated.client_id,
      client_name: updated.name,
      redirect_uris: parseJsonStringArray(updated.redirect_uris),
      grant_types: parseJsonStringArray(updated.grant_types),
      response_types: parseJsonStringArray(updated.response_types),
      scope: parseJsonStringArray(updated.allowed_scopes).join(' '),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    return c.json({ error: 'invalid_client_metadata', error_description: message }, 400);
  }
});

oauthRegister.delete('/register/:clientId', async (c) => {
  const clientId = c.req.param('clientId');
  const deleteAuthHeader = c.req.header('Authorization');
  const token = deleteAuthHeader?.startsWith('Bearer ') ? deleteAuthHeader.slice(7).trim() || null : null;

  if (!token) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const isValid = await validateRegistrationToken(c.env.DB, clientId, token);
  if (!isValid) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (client) {
    await tryLogOAuthEvent(c, {
      userId: client.owner_id || null,
      clientId: client.client_id,
      eventType: 'client_deleted',
    });
  }

  await deleteClient(c.env.DB, clientId);
  return c.body(null, 204);
});

export default oauthRegister;
