/**
 * Personal access token RPC for the account plane.
 * Ported from takosumi dashboard-ui/src/lib/rpc/tokens.ts.
 */
import { apiFetch } from "./http.ts";
import * as paths from "./paths.ts";

export interface PersonalAccessToken {
  readonly tokenId: string;
  readonly tokenPrefix: string;
  readonly name: string;
  readonly scopes?: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string | null;
  readonly revokedAt?: string | null;
  readonly lastUsedAt?: string | null;
}

interface ListResponse {
  readonly tokens?: readonly WirePersonalAccessToken[];
}

interface WirePersonalAccessToken {
  readonly id?: string;
  readonly prefix?: string;
  readonly name?: string;
  readonly scopes?: readonly string[];
  readonly created_at?: string;
  readonly expires_at?: string | null;
  readonly revoked_at?: string | null;
  readonly last_used_at?: string | null;
}

export interface CreateTokenInput {
  readonly name: string;
  readonly scopes?: readonly string[];
  readonly expiresInSeconds?: number;
}

export interface CreateTokenResult {
  /** Full token, returned once on create. Store it client-side; backend can't show it again. */
  readonly token: string;
  readonly tokenId: string;
  readonly tokenPrefix: string;
  readonly name: string;
  readonly scopes?: readonly string[];
  readonly expiresAt?: string | null;
}

interface CreateTokenWireResult {
  readonly token?: string;
  readonly token_record?: WirePersonalAccessToken;
}

const DEFAULT_CREATE_SCOPES = ["read", "write"] as const;

export async function listTokens(): Promise<readonly PersonalAccessToken[]> {
  const body = await apiFetch<
    ListResponse | readonly WirePersonalAccessToken[]
  >(paths.ACCOUNT_TOKENS);
  const tokens = isWirePersonalAccessTokenArray(body)
    ? body
    : body.tokens ?? [];
  return tokens.map(deserializePersonalAccessToken);
}

export async function createToken(
  input: CreateTokenInput,
): Promise<CreateTokenResult> {
  const body = await apiFetch<CreateTokenWireResult>(paths.ACCOUNT_TOKENS, {
    method: "POST",
    body: {
      name: input.name,
      scopes: input.scopes ?? DEFAULT_CREATE_SCOPES,
      expiresInSeconds: input.expiresInSeconds,
    },
  });
  return deserializeCreateTokenResult(body);
}

export async function revokeToken(tokenId: string): Promise<void> {
  await apiFetch<unknown>(paths.accountTokenRevoke(tokenId), {
    method: "POST",
  });
}

function deserializePersonalAccessToken(
  raw: WirePersonalAccessToken,
): PersonalAccessToken {
  return {
    tokenId: raw.id ?? "",
    tokenPrefix: raw.prefix ?? "",
    name: raw.name ?? "",
    scopes: raw.scopes,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at,
    revokedAt: raw.revoked_at,
    lastUsedAt: raw.last_used_at,
  };
}

function isWirePersonalAccessTokenArray(
  value: ListResponse | readonly WirePersonalAccessToken[],
): value is readonly WirePersonalAccessToken[] {
  return Array.isArray(value);
}

function deserializeCreateTokenResult(
  raw: CreateTokenWireResult,
): CreateTokenResult {
  const record = deserializePersonalAccessToken(raw.token_record ?? {});
  return {
    token: raw.token ?? "",
    tokenId: record.tokenId,
    tokenPrefix: record.tokenPrefix,
    name: record.name,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
  };
}
