import {
  AuthorizationError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import type { Env } from "../../../shared/types/env.ts";
import { accountsDelegatedAuthorization } from "../../../server/routes/auth/accounts-delegation.ts";
import { takosumiAppClaims, takosumiWorkspaceId } from "../../../server/routes/auth/takosumi-app-claims.ts";
import { TAKOSUMI_ACCOUNTS_USERINFO_PATH } from "@takosjp/takosumi-contract/identity-oidc";
import type { RuntimeInterfaceFetch } from "./runtime-interface-client.ts";

export type OperatorAiAuthorizationEnv = Pick<Env,
  | "DB" | "APP_CAPSULE_ID" | "OIDC_ISSUER_URL" | "OIDC_CLIENT_ID"
  | "OIDC_CLIENT_SECRET" | "ENCRYPTION_KEY" | "OIDC_DISCOVERY_URL"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
>;

type AuthorizationDeps = {
  accountsDelegatedAuthorization: typeof accountsDelegatedAuthorization;
  fetch: RuntimeInterfaceFetch;
};

export const operatorAiAuthorizationDeps: AuthorizationDeps = {
  accountsDelegatedAuthorization,
  fetch: (input, init) => fetch(input, init),
};

/** Revalidate the actual actor, never the local workspace owner or a cached role. */
export async function userHasCurrentAppMembership(
  env: OperatorAiAuthorizationEnv,
  userId: string | undefined,
  deps: AuthorizationDeps = operatorAiAuthorizationDeps,
): Promise<boolean> {
  if (!userId) return false;
  const issuer = env.OIDC_ISSUER_URL?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const encryptionKey = env.ENCRYPTION_KEY?.trim();
  if (!issuer || !clientId || !encryptionKey) return false;
  const authorization = await deps.accountsDelegatedAuthorization({
    db: env.DB,
    encryptionKey,
    userId,
    issuer: issuer.replace(/\/+$/u, ""),
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET?.trim() || undefined,
    access: "read",
  });
  const baseUrl = env.TAKOSUMI_ACCOUNTS_INTERNAL_URL?.trim() ||
    env.OIDC_DISCOVERY_URL?.trim() || issuer;
  const response = await deps.fetch(
    `${baseUrl.replace(/\/+$/u, "")}${TAKOSUMI_ACCOUNTS_USERINFO_PATH}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorization.accessToken}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status >= 500) {
    throw new ServiceUnavailableError("App membership authorization is unavailable");
  }
  if (!response.ok) return false;
  const claims: unknown = await response.json();
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return false;
  const userInfo = claims as Record<string, unknown>;
  if (userInfo.sub !== authorization.subjectId) return false;
  const app = takosumiAppClaims(userInfo, env.APP_CAPSULE_ID);
  if (app) return app.appRole !== undefined;
  // Claim-absent legacy clients retain the verified singleton Workspace gate.
  takosumiWorkspaceId(userInfo);
  return true;
}

/** Configured apps reserve operator-funded inference for current app members. */
export async function requireOperatorAiMembership(
  env: OperatorAiAuthorizationEnv,
  userId: string | undefined,
): Promise<void> {
  if (!env.APP_CAPSULE_ID?.trim()) return;
  let allowed: boolean;
  try {
    allowed = await userHasCurrentAppMembership(env, userId);
  } catch {
    throw new ServiceUnavailableError("App membership authorization is unavailable");
  }
  if (!allowed) {
    throw new AuthorizationError("App membership is required for operator-funded AI");
  }
}
