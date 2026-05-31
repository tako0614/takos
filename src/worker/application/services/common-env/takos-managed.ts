import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { eq } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { ALL_API_BEARER_SCOPES } from "../../../shared/types/api-scopes.ts";
import { normalizeEnvName } from "./crypto.ts";
import type { SyncState } from "./repository.ts";
import { RETIRED_APP_LOCAL_TAKOS_TOKEN_MESSAGE } from "../identity/takos-access-tokens.ts";
import { accounts, getDb } from "../../../infra/db/index.ts";
import { GoneError } from "@takos/worker-platform-utils/errors";

export const TAKOS_API_URL_ENV_NAME = "TAKOS_API_URL";
export const TAKOS_ACCESS_TOKEN_ENV_NAME = "TAKOS_ACCESS_TOKEN";
const VALID_SCOPE_SET = new Set(ALL_API_BEARER_SCOPES);

export type TakosTokenSubjectMode = "owner_principal" | "space_agent";

type SpaceIdentityRow = {
  id: string;
  kind: "user" | "team" | "system";
  name: string;
  slug: string | null;
  owner_user_id: string;
  owner_principal_id: string;
};

export interface TakosManagedStatus {
  managed: true;
  available: boolean;
  configured?: boolean;
  scopes?: string[];
  subject_mode?: TakosTokenSubjectMode;
  sync_state?:
    | "managed"
    | "pending"
    | "missing_common"
    | "missing_included"
    | "overridden"
    | "error";
  sync_reason?: string | null;
}

type LinkStateLike = {
  syncState: SyncState;
  syncReason: string | null;
};

export function normalizeTakosScopes(scopes: string[]): string[] {
  const normalized = [
    ...new Set(
      (scopes || []).map((scope) => String(scope || "").trim()).filter(Boolean),
    ),
  ];
  if (normalized.length === 0) {
    throw new Error("TAKOS_ACCESS_TOKEN requires at least one scope");
  }
  const invalid = normalized.filter((scope) => !VALID_SCOPE_SET.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Unknown Takos scopes: ${invalid.join(", ")}`);
  }
  return normalized;
}

export function resolveTakosApiUrl(
  env: Pick<Env, "ADMIN_DOMAIN">,
): string | null {
  const adminDomain = String(env.ADMIN_DOMAIN || "").trim();
  if (!adminDomain) return null;
  return `https://${adminDomain}`;
}

export function resolveTakosInternalApiUrl(
  env: Pick<Env, "ADMIN_DOMAIN" | "TAKOS_INTERNAL_API_URL">,
): string | null {
  const internalUrl = String(env.TAKOS_INTERNAL_API_URL || "").trim();
  if (internalUrl) {
    try {
      const parsed = new URL(internalUrl);
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      throw new Error("TAKOS_INTERNAL_API_URL must be an absolute URL");
    }
  }
  return resolveTakosApiUrl(env);
}

async function loadSpaceIdentity(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<SpaceIdentityRow | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();
  if (!row) return null;

  const kind = row.type === "user"
    ? "user"
    : row.type === "system"
    ? "system"
    : "team";
  const ownerUserId = row.type === "user"
    ? row.id
    : (row.ownerAccountId ?? row.id);
  return {
    id: row.id,
    kind: kind as "user" | "team" | "system",
    name: row.name,
    slug: row.slug,
    owner_user_id: ownerUserId,
    // In the current schema, account id IS the principal id
    owner_principal_id: ownerUserId,
  };
}

export async function resolveTakosTokenSubject(params: {
  env: Pick<Env, "DB">;
  spaceId: string;
}): Promise<
  {
    subjectUserId: string;
    subjectMode: TakosTokenSubjectMode;
    space: SpaceIdentityRow;
  }
> {
  const space = await loadSpaceIdentity(params.env.DB, params.spaceId);
  if (!space) {
    throw new Error(`Space not found: ${params.spaceId}`);
  }
  if (space.kind === "user") {
    return {
      subjectUserId: space.owner_user_id,
      subjectMode: "owner_principal",
      space,
    };
  }
  // For team spaces, the account id itself acts as the principal
  return {
    subjectUserId: space.owner_user_id,
    subjectMode: "space_agent",
    space,
  };
}

export async function deleteManagedTakosTokenConfig(params: {
  env: Pick<Env, "DB">;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  envName?: string;
}): Promise<void> {
  const envName = normalizeEnvName(
    params.envName || TAKOS_ACCESS_TOKEN_ENV_NAME,
  );
  const serviceId = params.serviceId ?? params.workerId ?? "";
  if (!serviceId) {
    throw new Error("deleteManagedTakosTokenConfig requires a serviceId");
  }
  void envName;
}

export async function upsertManagedTakosTokenConfig(_params: {
  env: Pick<Env, "DB" | "ENCRYPTION_KEY">;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  scopes: string[];
  envName?: string;
}): Promise<void> {
  throw new GoneError(RETIRED_APP_LOCAL_TAKOS_TOKEN_MESSAGE);
}

export async function ensureManagedTakosTokenValue(_params: {
  env: Pick<Env, "DB" | "ENCRYPTION_KEY">;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  envName?: string;
}): Promise<
  { value: string; scopes: string[]; subjectMode: TakosTokenSubjectMode } | null
> {
  throw new GoneError(RETIRED_APP_LOCAL_TAKOS_TOKEN_MESSAGE);
}

export async function listTakosManagedStatuses(params: {
  env: Pick<Env, "DB" | "ADMIN_DOMAIN">;
  spaceId: string;
  serviceId?: string;
  workerId?: string;
  linkStateByName?: Map<string, LinkStateLike>;
}): Promise<Record<string, TakosManagedStatus>> {
  const serviceId = params.serviceId ?? params.workerId ?? "";
  if (!serviceId) {
    throw new Error("listTakosManagedStatuses requires a serviceId");
  }
  const space = await loadSpaceIdentity(params.env.DB, params.spaceId);
  if (!space) {
    throw new Error(`Space not found: ${params.spaceId}`);
  }
  const apiUrl = resolveTakosApiUrl(params.env);
  const apiLinkState = params.linkStateByName?.get(TAKOS_API_URL_ENV_NAME) ||
    null;

  return {
    [TAKOS_API_URL_ENV_NAME]: {
      managed: true,
      available: Boolean(apiUrl),
      sync_state: apiLinkState
        ? (apiLinkState.syncState === "missing_common"
          ? "missing_included"
          : apiLinkState.syncState)
        : (apiUrl ? "managed" : "error"),
      sync_reason: apiLinkState?.syncReason ??
        (apiUrl ? null : "admin_domain_missing"),
    },
  };
}

export async function markManagedTakosTokenUsedByHash(
  _db: SqlDatabaseBinding,
  _tokenHash: string,
): Promise<void> {
  // App-local managed Takos tokens are retired; the historical table is gone.
}
