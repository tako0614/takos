import {
  AuthenticationError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import type { Env } from "../../../shared/types/env.ts";
import { accountsDelegatedAuthorization } from "../../../server/routes/auth/accounts-delegation.ts";
import type { RuntimeInterfaceRequestConfig } from "./runtime-interface-client.ts";

export type RuntimeInterfaceAuthorization = RuntimeInterfaceRequestConfig & {
  readonly workspaceId: string;
};

export type RuntimeInterfaceBearerContext = {
  readonly accessToken: string;
  readonly subjectId: string;
  readonly workspaceId: string;
};

export const runtimeInterfaceAuthorizationDeps = {
  accountsDelegatedAuthorization,
};

function configuredUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ServiceUnavailableError(
      "Takosumi runtime Interface API URL is invalid",
    );
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    throw new ServiceUnavailableError(
      "Takosumi runtime Interface API URL is invalid",
    );
  }
  return url.toString();
}

function configuredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

/**
 * Resolve the current user's Workspace-bound Takosumi OAuth delegation.
 *
 * Local Takos Workspace identifiers never cross this boundary. The returned
 * Workspace and Principal both come from the same external Accounts grant and
 * are the only selectors accepted by Interface discovery.
 */
export async function resolveRuntimeInterfaceAuthorization(
  env: Env,
  userId: string,
  bearer?: RuntimeInterfaceBearerContext,
): Promise<RuntimeInterfaceAuthorization> {
  const baseUrl = configuredUrl(
    env.TAKOSUMI_ACCOUNTS_INTERNAL_URL ??
      env.TAKOSUMI_ACCOUNTS_URL ??
      env.OIDC_ISSUER_URL,
  );
  if (
    baseUrl &&
    bearer?.accessToken.trim() &&
    bearer.subjectId.trim() &&
    bearer.workspaceId.trim()
  ) {
    return {
      baseUrl,
      token: bearer.accessToken,
      subjectId: bearer.subjectId,
      workspaceId: bearer.workspaceId,
    };
  }
  const issuer = configuredUrl(env.OIDC_ISSUER_URL);
  const clientId = configuredString(env.OIDC_CLIENT_ID);
  const encryptionKey = configuredString(env.ENCRYPTION_KEY);
  if (!issuer || !clientId || !encryptionKey || !baseUrl) {
    throw new ServiceUnavailableError(
      "Takosumi runtime Interface authorization is not configured",
    );
  }

  const authorization =
    await runtimeInterfaceAuthorizationDeps.accountsDelegatedAuthorization({
      db: env.DB,
      encryptionKey,
      userId,
      issuer: issuer.replace(/\/+$/u, ""),
      clientId,
      clientSecret: configuredString(env.OIDC_CLIENT_SECRET),
      access: "read",
    });
  if (
    !authorization.workspaceId.trim() ||
    !authorization.subjectId.trim() ||
    !authorization.accessToken.trim()
  ) {
    throw new AuthenticationError(
      "Takosumi runtime Interface authorization must be renewed",
    );
  }
  return {
    baseUrl,
    token: authorization.accessToken,
    subjectId: authorization.subjectId,
    workspaceId: authorization.workspaceId,
  };
}
