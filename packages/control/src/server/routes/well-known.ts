/**
 * Well-Known Endpoints
 *
 * Implements:
 * - OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * - JSON Web Key Set (JWKS)
 */

import { Hono } from 'hono';
import * as jose from 'jose';
import type { Env } from '../../shared/types';
import type { OAuthServerMetadata } from '../../shared/types/oauth';
import { ALL_SCOPES, DEVICE_CODE_GRANT_TYPE } from '../../shared/types/oauth';
import { logError } from '../../shared/utils/logger';
import { InternalError } from '@takos/common/errors';

const wellKnown = new Hono<{ Bindings: Env }>();

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
wellKnown.get('/oauth-authorization-server', async (c) => {
  const issuer = `https://${c.env.ADMIN_DOMAIN}`;

  const metadata: OAuthServerMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    device_authorization_endpoint: `${issuer}/oauth/device/code`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT_TYPE],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    code_challenge_methods_supported: ['S256'],
  };

  return c.json(metadata, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

/**
 * GET /.well-known/jwks.json
 * JSON Web Key Set
 */
wellKnown.get('/jwks.json', async (c) => {
  try {
    // Import public key
    const publicKey = await jose.importSPKI(c.env.PLATFORM_PUBLIC_KEY, 'RS256');

    // Export as JWK
    const jwk = await jose.exportJWK(publicKey);

    // Add metadata
    const keyWithMetadata = {
      ...jwk,
      kid: 'takos-oauth-1',
      use: 'sig',
      alg: 'RS256',
    };

    const jwks = {
      keys: [keyWithMetadata],
    };

    return c.json(jwks, 200, {
      'Cache-Control': 'public, max-age=86400', // 24 hours
    });
  } catch (error) {
    logError('JWKS generation error', error, { module: 'routes/well-known' });
    throw new InternalError('Failed to generate JWKS');
  }
});

/**
 * GET /.well-known/openid-configuration
 * OpenID Connect Discovery (subset for OAuth2)
 */
wellKnown.get('/openid-configuration', async (c) => {
  const issuer = `https://${c.env.ADMIN_DOMAIN}`;

  const config = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    device_authorization_endpoint: `${issuer}/oauth/device/code`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT_TYPE],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'scope', 'client_id'],
  };

  return c.json(config, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

export default wellKnown;
