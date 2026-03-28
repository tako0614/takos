import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../shared/types/drizzle-helpers';
import { oauthAuthorizationCodes } from '../../../infra/db';
import type {
  OAuthAuthorizationCode,
  OAuthClient,
  AuthorizationRequest,
  CodeChallengeMethod,
} from '../../../shared/types/oauth';
import { OAUTH_CONSTANTS } from '../../../shared/types/oauth';
import {
  generateRandomString,
  generateId,
  verifyCodeChallenge,
  isValidCodeChallenge,
} from './pkce';
import { computeSHA256 } from '../../../shared/utils/hash';
import {
  getClientById,
  validateRedirectUri,
  supportsGrantType,
  getClientAllowedScopes,
} from './client';
import { parseScopes, areScopesAllowed, validateScopes } from './scopes';
import { getDb } from '../../../infra/db';
import { eq, and, lt } from 'drizzle-orm';
import { revokeTokensByAuthorizationCode } from './token';
import { toIsoString } from '../../../shared/utils';

type OAuthAuthorizationCodeRow = SelectOf<typeof oauthAuthorizationCodes>;

function toApiAuthorizationCode(row: OAuthAuthorizationCodeRow): OAuthAuthorizationCode {
  return {
    id: row.id,
    code_hash: row.codeHash,
    client_id: row.clientId,
    user_id: row.accountId,
    redirect_uri: row.redirectUri,
    scope: row.scope,
    code_challenge: row.codeChallenge,
    code_challenge_method: row.codeChallengeMethod as CodeChallengeMethod,
    used: row.used,
    expires_at: toIsoString(row.expiresAt),
    created_at: toIsoString(row.createdAt),
  };
}

export interface AuthorizationValidationResult {
  valid: boolean;
  client?: OAuthClient;
  error?: string;
  errorDescription?: string;
  redirectUri?: string;
}

function invalidResult(
  error: string,
  errorDescription: string,
  redirectUri?: string,
): AuthorizationValidationResult {
  return { valid: false, error, errorDescription, redirectUri };
}

export async function validateAuthorizationRequest(
  dbBinding: D1Database,
  request: Partial<AuthorizationRequest>
): Promise<AuthorizationValidationResult> {
  if (request.response_type !== 'code') {
    return invalidResult('unsupported_response_type', 'Only response_type=code is supported');
  }

  if (!request.client_id) {
    return invalidResult('invalid_request', 'client_id is required');
  }

  const client = await getClientById(dbBinding, request.client_id);
  if (!client) {
    return invalidResult('invalid_client', 'Client not found');
  }

  if (!request.redirect_uri) {
    return invalidResult('invalid_request', 'redirect_uri is required');
  }

  if (!validateRedirectUri(client, request.redirect_uri)) {
    return invalidResult('invalid_request', 'redirect_uri not registered');
  }

  // From here, errors can safely redirect to the redirect_uri
  const redirectUri = request.redirect_uri;

  if (!request.state) {
    return invalidResult('invalid_request', 'state is required', redirectUri);
  }

  if (!request.code_challenge) {
    return invalidResult('invalid_request', 'code_challenge is required (PKCE)', redirectUri);
  }

  if (request.code_challenge_method !== 'S256') {
    return invalidResult('invalid_request', 'code_challenge_method must be S256', redirectUri);
  }

  if (!isValidCodeChallenge(request.code_challenge)) {
    return invalidResult('invalid_request', 'Invalid code_challenge format', redirectUri);
  }

  if (!supportsGrantType(client, 'authorization_code')) {
    return invalidResult('unauthorized_client', 'Client does not support authorization_code grant', redirectUri);
  }

  if (!request.scope) {
    return invalidResult('invalid_request', 'scope is required', redirectUri);
  }

  const requestedScopes = parseScopes(request.scope);
  const { valid: scopesValid, unknown } = validateScopes(requestedScopes);
  if (!scopesValid) {
    return invalidResult('invalid_scope', `Unknown scopes: ${unknown.join(', ')}`, redirectUri);
  }

  const allowedScopes = getClientAllowedScopes(client);
  if (!areScopesAllowed(requestedScopes, allowedScopes)) {
    return invalidResult('invalid_scope', 'Requested scope exceeds allowed scopes', redirectUri);
  }

  return { valid: true, client, redirectUri };
}

export async function generateAuthorizationCode(
  dbBinding: D1Database,
  params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: CodeChallengeMethod;
  }
): Promise<string> {
  const db = getDb(dbBinding);

  const code = generateRandomString(OAUTH_CONSTANTS.AUTHORIZATION_CODE_LENGTH);
  const codeHash = await computeSHA256(code);
  const id = generateId();

  const expiresAt = new Date(
    Date.now() + OAUTH_CONSTANTS.AUTHORIZATION_CODE_EXPIRES_IN * 1000
  );

  await db.insert(oauthAuthorizationCodes).values({
    id,
    codeHash,
    clientId: params.clientId,
    accountId: params.userId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    used: false,
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  });

  return code;
}

export interface CodeExchangeResult {
  valid: boolean;
  code?: OAuthAuthorizationCode;
  error?: string;
  errorDescription?: string;
}

export async function exchangeAuthorizationCode(
  dbBinding: D1Database,
  params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }
): Promise<CodeExchangeResult> {
  const db = getDb(dbBinding);
  const { code, clientId, redirectUri, codeVerifier } = params;

  function invalidGrant(errorDescription: string): CodeExchangeResult {
    return { valid: false, error: 'invalid_grant', errorDescription };
  }

  const codeHash = await computeSHA256(code);
  const authCode = await db.select().from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash)).get();

  if (!authCode) {
    return invalidGrant('Authorization code not found');
  }

  const apiAuthCode = toApiAuthorizationCode(authCode);

  // Replay attack detection: revoke all tokens if code was already used
  if (apiAuthCode.used) {
    await revokeTokensByAuthorizationCode(dbBinding, apiAuthCode.id);
    return invalidGrant('Authorization code already used');
  }

  if (new Date(apiAuthCode.expires_at) < new Date()) {
    return invalidGrant('Authorization code expired');
  }

  if (apiAuthCode.client_id !== clientId) {
    return invalidGrant('Client ID mismatch');
  }

  if (apiAuthCode.redirect_uri !== redirectUri) {
    return invalidGrant('Redirect URI mismatch');
  }

  if (apiAuthCode.code_challenge_method !== 'S256') {
    return invalidGrant('Unsupported PKCE code challenge method');
  }

  const pkceValid = await verifyCodeChallenge(
    codeVerifier,
    apiAuthCode.code_challenge,
    apiAuthCode.code_challenge_method
  );

  if (!pkceValid) {
    return invalidGrant('PKCE verification failed');
  }

  // Atomic CAS to prevent race conditions
  const updateResult = await db.update(oauthAuthorizationCodes)
    .set({ used: true })
    .where(
      and(
        eq(oauthAuthorizationCodes.id, apiAuthCode.id),
        eq(oauthAuthorizationCodes.used, false),
      )
    );

  if ((updateResult.meta.changes ?? 0) === 0) {
    await revokeTokensByAuthorizationCode(dbBinding, apiAuthCode.id);
    return invalidGrant('Authorization code already used');
  }

  return { valid: true, code: apiAuthCode };
}

export async function deleteExpiredCodes(dbBinding: D1Database): Promise<number> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const result = await db.delete(oauthAuthorizationCodes).where(
    lt(oauthAuthorizationCodes.expiresAt, now)
  );

  return result.meta.changes ?? 0;
}

export function buildErrorRedirect(
  redirectUri: string,
  state: string,
  error: string,
  errorDescription?: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (errorDescription) {
    url.searchParams.set('error_description', errorDescription);
  }
  url.searchParams.set('state', state);
  return url.toString();
}

export function buildSuccessRedirect(
  redirectUri: string,
  state: string,
  code: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);
  return url.toString();
}
