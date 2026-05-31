import {
  BadGatewayError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import type { Env } from "../../../shared/types/index.ts";

type InstallableAppInstallEnv = Pick<
  Env,
  | "OIDC_DISCOVERY_URL"
  | "OIDC_ISSUER_URL"
  | "TAKOS_APP_INSTALLATIONS_URL"
  | "TAKOS_APP_INSTALL_TOKEN"
  | "TAKOS_APP_INSTALL_ACCOUNT_ID"
  | "TAKOS_APP_INSTALL_SUBJECT"
  | "TAKOS_APP_INSTALL_MODE"
  | "TAKOS_APP_INSTALL_RUNTIME_BASE_URL"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_URL"
>;

export type InstallableAppInstallConfig = {
  installationsUrl?: string;
  token?: string;
  accountId?: string;
  subject?: string;
  mode?: string;
  runtimeBaseUrl?: string;
};

export type InstallableAppAccountsConfig = {
  baseUrl: string;
  token?: string;
};

type InstallableAppFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const installableAppInstallDeps: {
  fetch: InstallableAppFetch;
} = {
  fetch: (input, init) => fetch(input, init),
};

export type InstallableAppSourceInput = {
  gitUrl: string;
  ref: string;
};

export type InstallableAppDryRunInput = InstallableAppSourceInput & {
  spaceId: string;
};

export type InstallableAppApplyInput = InstallableAppSourceInput & {
  accountId: string;
  spaceId: string;
  subject: string;
  mode?: string;
  runtimeBaseUrl?: string;
  sourceCommit?: string;
  expectedCommit?: string;
  expectedManifestDigest?: string;
  costAck?: boolean;
};

export type InstallableAppRevisionOperation = "upgrade" | "rollback";

export type InstallableAppRevisionInput = InstallableAppSourceInput & {
  installationId: string;
  operation: InstallableAppRevisionOperation;
  sourceCommit?: string;
  reason?: string;
};

export type InstallableAppUpstreamResponse = {
  status: number;
  body: Record<string, unknown> | null;
};

function readEnvString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ServiceUnavailableError(`${field} must be an absolute HTTP URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ServiceUnavailableError(`${field} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new ServiceUnavailableError(`${field} must not include credentials`);
  }
  return parsed.toString();
}

function normalizeInstallationsUrl(value: string, field: string): string {
  const normalized = normalizeHttpUrl(value, field);
  const url = new URL(normalized);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath.endsWith("/v1/installations")
    ? basePath
    : `${basePath}/v1/installations`;
  url.search = "";
  return url.toString();
}

function appendInstallationsPath(
  installationsUrl: string,
  suffix: string,
): string {
  const url = new URL(installationsUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${suffix}`;
  url.search = "";
  return url.toString();
}

function installDryRunUrl(config: InstallableAppInstallConfig): string {
  return appendInstallationsPath(requireInstallationsUrl(config), "/dry-run");
}

function deploymentDryRunUrl(
  config: InstallableAppInstallConfig,
  installationId: string,
): string {
  return appendInstallationsPath(
    requireInstallationsUrl(config),
    `/${encodeURIComponent(installationId)}/deployments/dry-run`,
  );
}

function deploymentApplyUrl(
  config: InstallableAppInstallConfig,
  installationId: string,
): string {
  return appendInstallationsPath(
    requireInstallationsUrl(config),
    `/${encodeURIComponent(installationId)}/deployments`,
  );
}

function rollbackUrl(
  config: InstallableAppInstallConfig,
  installationId: string,
): string {
  return appendInstallationsPath(
    requireInstallationsUrl(config),
    `/${encodeURIComponent(installationId)}/rollback`,
  );
}

export function resolveInstallableAppAccountsConfig(
  env: InstallableAppInstallEnv,
): InstallableAppAccountsConfig | null {
  const baseUrl = readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL) ??
    readEnvString(env.OIDC_DISCOVERY_URL) ??
    readEnvString(env.OIDC_ISSUER_URL);
  if (!baseUrl) return null;
  return {
    baseUrl: normalizeHttpUrl(baseUrl, "TAKOSUMI_ACCOUNTS_URL"),
    ...(readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN)
      ? { token: readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN) }
      : {}),
  };
}

export function resolveInstallableAppInstallConfig(
  env: InstallableAppInstallEnv,
): InstallableAppInstallConfig | null {
  const installationsUrl = readEnvString(env.TAKOS_APP_INSTALLATIONS_URL);
  const token = readEnvString(env.TAKOS_APP_INSTALL_TOKEN);
  const accountId = readEnvString(env.TAKOS_APP_INSTALL_ACCOUNT_ID);
  const subject = readEnvString(env.TAKOS_APP_INSTALL_SUBJECT);
  const mode = readEnvString(env.TAKOS_APP_INSTALL_MODE);
  const runtimeBaseUrl = readEnvString(
    env.TAKOS_APP_INSTALL_RUNTIME_BASE_URL,
  );
  const configured = Boolean(
    installationsUrl || token || accountId || subject || mode ||
      runtimeBaseUrl,
  );
  if (!configured) return null;
  return {
    ...(installationsUrl
      ? {
        installationsUrl: normalizeInstallationsUrl(
          installationsUrl,
          "TAKOS_APP_INSTALLATIONS_URL",
        ),
      }
      : {}),
    ...(token ? { token } : {}),
    ...(accountId ? { accountId } : {}),
    ...(subject ? { subject } : {}),
    ...(mode ? { mode } : {}),
    ...(runtimeBaseUrl
      ? {
        runtimeBaseUrl: normalizeHttpUrl(
          runtimeBaseUrl,
          "TAKOS_APP_INSTALL_RUNTIME_BASE_URL",
        ),
      }
      : {}),
  };
}

function requireInstallationsUrl(config: InstallableAppInstallConfig): string {
  if (!config.installationsUrl) {
    throw new ServiceUnavailableError(
      "Third-party Installation API is not configured",
    );
  }
  return config.installationsUrl;
}

function requireApplyConfig(config: InstallableAppInstallConfig): {
  installUrl: string;
  token: string;
} {
  if (!config.installationsUrl || !config.token) {
    throw new ServiceUnavailableError(
      "Third-party Installation apply is not configured",
    );
  }
  return { installUrl: config.installationsUrl, token: config.token };
}

function requireRevisionApplyConfig(config: InstallableAppInstallConfig): {
  token: string;
} {
  if (!config.installationsUrl || !config.token) {
    throw new ServiceUnavailableError(
      "Third-party Installation deployment apply is not configured",
    );
  }
  return { token: config.token };
}

function requireAccountsConfig(
  config: InstallableAppAccountsConfig | null,
): InstallableAppAccountsConfig {
  if (!config) {
    throw new ServiceUnavailableError(
      "Takosumi Accounts Installation ledger API is not configured",
    );
  }
  return config;
}

function accountsInstallationsUrl(
  config: InstallableAppAccountsConfig,
  installationId?: string,
): URL {
  const url = new URL(config.baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const installationsPath = basePath.endsWith("/v1/installations")
    ? basePath
    : `${basePath}/v1/installations`;
  url.pathname = installationId
    ? `${installationsPath}/${encodeURIComponent(installationId)}`
    : installationsPath;
  url.search = "";
  return url;
}

async function readResponseBody(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { error: text.length > 400 ? `${text.slice(0, 400)}...` : text };
  }
}

async function postInstallableAppJson(
  url: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<InstallableAppUpstreamResponse> {
  let response: Response;
  try {
    response = await installableAppInstallDeps.fetch(url, {
      method: "POST",
      headers: {
        ...(token ? { "authorization": `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BadGatewayError("Failed to reach Takosumi installer API");
  }
  return {
    status: response.status,
    body: await readResponseBody(response),
  };
}

async function fetchAccountsJson(
  url: URL,
  init: RequestInit,
  token?: string,
): Promise<InstallableAppUpstreamResponse> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await installableAppInstallDeps.fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new BadGatewayError("Failed to reach Takosumi Accounts");
  }
  return {
    status: response.status,
    body: await readResponseBody(response),
  };
}

export async function listInstallableAppInstallations(
  spaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const url = accountsInstallationsUrl(accountsConfig);
  url.searchParams.set("space_id", spaceId);
  return await fetchAccountsJson(url, { method: "GET" }, accountsConfig.token);
}

export async function deleteInstallableAppInstallation(
  installationId: string,
  config: InstallableAppAccountsConfig | null,
  reason?: string,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const body = reason ? JSON.stringify({ reason }) : undefined;
  return await fetchAccountsJson(
    accountsInstallationsUrl(accountsConfig, installationId),
    {
      method: "DELETE",
      ...(body
        ? { body, headers: { "content-type": "application/json" } }
        : {}),
    },
    accountsConfig.token,
  );
}

export async function dryRunInstallableAppInstallation(
  input: InstallableAppDryRunInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  return await postInstallableAppJson(installDryRunUrl(config), {
    spaceId: input.spaceId,
    source: {
      kind: "git",
      url: input.gitUrl,
      ref: input.ref,
    },
  }, config.token);
}

export async function applyInstallableAppInstallation(
  input: InstallableAppApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const { installUrl, token } = requireApplyConfig(config);
  return await postInstallableAppJson(installUrl, {
    spaceId: input.spaceId,
    source: {
      kind: "git",
      url: input.gitUrl,
      ref: input.ref,
      ...(input.sourceCommit ? { commit: input.sourceCommit } : {}),
    },
    ...(input.expectedCommit && input.expectedManifestDigest
      ? {
        expected: {
          commit: input.expectedCommit,
          manifestDigest: input.expectedManifestDigest,
        },
      }
      : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.runtimeBaseUrl ? { runtimeBaseUrl: input.runtimeBaseUrl } : {}),
    ...(input.costAck === undefined ? {} : { costAck: input.costAck }),
  }, token);
}

export async function dryRunInstallableAppRevision(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  return await postInstallableAppJson(
    deploymentDryRunUrl(
      config,
      input.installationId,
    ),
    {
      source: {
        kind: "git",
        url: input.gitUrl,
        ref: input.ref,
        ...(input.sourceCommit ? { commit: input.sourceCommit } : {}),
      },
      ...(input.reason ? { reason: input.reason } : {}),
    },
    config.token,
  );
}

export async function applyInstallableAppRevision(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const { token } = requireRevisionApplyConfig(config);
  const url = input.operation === "rollback"
    ? rollbackUrl(config, input.installationId)
    : deploymentApplyUrl(config, input.installationId);
  return await postInstallableAppJson(url, {
    ...(input.operation === "rollback" ? { deploymentId: input.ref } : {
      source: {
        kind: "git",
        url: input.gitUrl,
        ref: input.ref,
        ...(input.sourceCommit ? { commit: input.sourceCommit } : {}),
      },
    }),
    ...(input.reason ? { reason: input.reason } : {}),
  }, token);
}
