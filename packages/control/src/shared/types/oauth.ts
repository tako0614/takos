export type OAuthClientType = 'confidential' | 'public';
export type OAuthClientStatus = 'active' | 'suspended' | 'revoked';
export type OAuthTokenType = 'access' | 'refresh';
export type OAuthConsentStatus = 'active' | 'revoked';
export type OAuthDeviceCodeStatus = 'pending' | 'approved' | 'denied' | 'used';
export type CodeChallengeMethod = 'S256';

/**
 * A branded string type representing a JSON-serialized array stored in SQLite TEXT columns.
 *
 * Values must be valid JSON arrays (e.g. `'["authorization_code","refresh_token"]'`).
 * Use {@link parseJsonStringArray} to deserialize, or `JSON.stringify(arr)` to create.
 *
 * @example
 *   const raw: JsonStringArray = '["a","b"]' as JsonStringArray;
 *   const parsed: string[] = parseJsonStringArray(raw); // ["a", "b"]
 */
export type JsonStringArray = string & { readonly __brand: 'JsonStringArray' };

/**
 * Parse a {@link JsonStringArray} into a native `string[]`.
 * Returns `fallback` if the value is not valid JSON.
 */
export function parseJsonStringArray(value: JsonStringArray | string, fallback: string[] = []): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Represents an OAuth client row as stored in the database.
 *
 * Fields marked as {@link JsonStringArray} are stored as JSON-serialized arrays in SQLite
 * TEXT columns (e.g. `'["https://example.com/callback"]'`). Use {@link parseJsonStringArray}
 * to deserialize them into `string[]`.
 *
 * For the API response shape with parsed arrays, see {@link ClientRegistrationResponse}.
 */
export interface OAuthClient {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  client_type: OAuthClientType;
  name: string;
  description: string | null;
  logo_uri: string | null;
  client_uri: string | null;
  policy_uri: string | null;
  tos_uri: string | null;
  /** JSON-serialized array of redirect URIs, e.g. `'["https://example.com/cb"]'` */
  redirect_uris: JsonStringArray;
  /** JSON-serialized array of grant types, e.g. `'["authorization_code","refresh_token"]'` */
  grant_types: JsonStringArray;
  /** JSON-serialized array of response types, e.g. `'["code"]'` */
  response_types: JsonStringArray;
  /** JSON-serialized array of allowed scope strings, e.g. `'["openid","profile"]'` */
  allowed_scopes: JsonStringArray;
  owner_id: string | null;
  registration_access_token_hash: string | null;
  status: OAuthClientStatus;
  created_at: string;
  updated_at: string;
}

export interface OAuthAuthorizationCode {
  id: string;
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: CodeChallengeMethod;
  used: boolean;
  expires_at: string;
  created_at: string;
}

export interface OAuthDeviceCode {
  id: string;
  device_code_hash: string;
  user_code_hash: string;
  client_id: string;
  scope: string;
  status: OAuthDeviceCodeStatus;
  user_id: string | null;
  interval_seconds: number;
  last_polled_at: string | null;
  approved_at: string | null;
  denied_at: string | null;
  used_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthToken {
  id: string;
  token_type: OAuthTokenType;
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  refresh_token_id: string | null;
  revoked: boolean;
  revoked_at: string | null;
  revoked_reason: string | null;
  used_at: string | null; // When this refresh token was first used (for reuse detection)
  token_family: string | null; // Groups related tokens for cascade revocation on reuse
  expires_at: string;
  created_at: string;
}

/**
 * Represents an OAuth consent record as stored in the database.
 *
 * The `scopes` field is a {@link JsonStringArray} stored as a JSON-serialized array
 * in a SQLite TEXT column (e.g. `'["openid","profile"]'`). Use {@link parseJsonStringArray}
 * to deserialize it into `string[]`.
 */
export interface OAuthConsent {
  id: string;
  user_id: string;
  client_id: string;
  /** JSON-serialized array of granted scope strings, e.g. `'["openid","profile"]'` */
  scopes: JsonStringArray;
  status: OAuthConsentStatus;
  granted_at: string;
  updated_at: string;
}

export interface AuthorizationRequest {
  response_type: 'code';
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: CodeChallengeMethod;
}

export const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code' as const;

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface OAuthAccessTokenPayload {
  iss: string; // Issuer
  sub: string; // Subject (user_id)
  aud: string; // Audience (client_id)
  exp: number; // Expiration time
  iat: number; // Issued at
  jti: string; // JWT ID
  scope: string; // Space-separated scopes
  client_id: string;
}

export interface ClientRegistrationRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
  contacts?: string[];
  token_endpoint_auth_method?: 'client_secret_post' | 'client_secret_basic' | 'none';
}

export interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
  registration_access_token: string;
  registration_client_uri: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  client_uri?: string;
  logo_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
}

export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  registration_endpoint?: string;
  device_authorization_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface OAuthScope {
  name: string;
  description: string;
  category: 'identity' | 'resource';
}

export const OAUTH_SCOPES: Record<string, OAuthScope> = {
  openid: { name: 'openid', description: 'OpenID Connect identity', category: 'identity' },
  profile: { name: 'profile', description: 'User profile (name, picture)', category: 'identity' },
  email: { name: 'email', description: 'Email address', category: 'identity' },
  'spaces:read': { name: 'spaces:read', description: 'Read workspaces', category: 'resource' },
  'spaces:write': { name: 'spaces:write', description: 'Write workspaces', category: 'resource' },
  'files:read': { name: 'files:read', description: 'Read files', category: 'resource' },
  'files:write': { name: 'files:write', description: 'Write files', category: 'resource' },
  'memories:read': { name: 'memories:read', description: 'Read memories', category: 'resource' },
  'memories:write': { name: 'memories:write', description: 'Write memories', category: 'resource' },
  'threads:read': { name: 'threads:read', description: 'Read threads', category: 'resource' },
  'threads:write': { name: 'threads:write', description: 'Write threads', category: 'resource' },
  'runs:read': { name: 'runs:read', description: 'Read runs', category: 'resource' },
  'runs:write': { name: 'runs:write', description: 'Trigger or cancel runs', category: 'resource' },
  'agents:execute': { name: 'agents:execute', description: 'Execute agents', category: 'resource' },
  'repos:read': { name: 'repos:read', description: 'Read repositories', category: 'resource' },
  'repos:write': { name: 'repos:write', description: 'Write repositories', category: 'resource' },
  'mcp:invoke': { name: 'mcp:invoke', description: 'Invoke MCP servers', category: 'resource' },
  'events:subscribe': { name: 'events:subscribe', description: 'Subscribe to space lifecycle events', category: 'resource' },
  'billing:meter': { name: 'billing:meter', description: 'Submit usage records', category: 'resource' },
};

export const ALL_SCOPES = Object.keys(OAUTH_SCOPES);

export const OAUTH_CONSTANTS = {
  ACCESS_TOKEN_EXPIRES_IN: 3600,
  REFRESH_TOKEN_EXPIRES_IN: 30 * 24 * 3600,
  AUTHORIZATION_CODE_EXPIRES_IN: 600,
  DEVICE_CODE_EXPIRES_IN: 900,
  DEVICE_POLL_INTERVAL_SECONDS: 5,

  AUTHORIZATION_CODE_LENGTH: 32,
  REFRESH_TOKEN_LENGTH: 32,
  CLIENT_ID_LENGTH: 16,
  CLIENT_SECRET_LENGTH: 32,
  REGISTRATION_ACCESS_TOKEN_LENGTH: 32,
  DEVICE_CODE_LENGTH: 32,
  DEVICE_USER_CODE_LENGTH: 8,
};
