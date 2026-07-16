import {
  BadGatewayError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import type { Env } from "../../../shared/types/index.ts";
import { readEnvString } from "./featured-app-validation.ts";
import { fetchCapsuleWorkloadServices } from "./takosumi-workload-services.ts";
import {
  takosumiCapsulePath,
  takosumiCapsulePlanPath,
  takosumiRunApplyPath,
  takosumiRunPath,
  takosumiSessionApiUrl,
  takosumiSourcePath,
  takosumiSourceSyncPath,
  takosumiSourcesPath,
  takosumiStateVersionRollbackPlanPath,
  takosumiWorkspaceCapsulesPath,
} from "../takosumi-control-paths.ts";

const DEFAULT_INSTALL_CONFIG_ID = "cfg-default-opentofu-capsule";
const DEFAULT_ENVIRONMENT = "production";

type InstallableAppInstallEnv = Pick<
  Env,
  | "OIDC_DISCOVERY_URL"
  | "OIDC_ISSUER_URL"
  | "TAKOS_APP_INSTALLATIONS_URL"
  | "TAKOS_APP_INSTALL_TOKEN"
  | "TAKOS_APP_INSTALL_ACCOUNT_ID"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_URL"
>;

export type InstallableAppInstallConfig = {
  controlUrl?: string;
  token?: string;
  headers?: HeadersInit;
  fetch?: InstallableAppFetch;
  accountId?: string;
};

export type InstallableAppAccountsConfig = {
  baseUrl: string;
  token?: string;
  headers?: HeadersInit;
  fetch?: InstallableAppFetch;
};

type InstallableAppFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const installableAppInstallDeps: {
  fetch: InstallableAppFetch;
  sleep: (milliseconds: number) => Promise<void>;
} = {
  fetch: (input, init) => fetch(input, init),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export type InstallableAppSourceInput = {
  gitUrl: string;
  ref: string;
  modulePath?: string;
};

export type InstallableAppPlanInput = InstallableAppSourceInput & {
  workspaceId: string;
  appId?: string;
  variables?: Record<string, unknown>;
};

export type InstallableAppApplyInput = {
  workspaceId: string;
  expected: Record<string, unknown>;
};

export type InstallableAppRevisionOperation = "upgrade" | "rollback";

export type InstallableAppRevisionInput = {
  workspaceId: string;
  capsuleId: string;
  operation: InstallableAppRevisionOperation;
  /** Git ref for upgrade, StateVersion id for rollback. */
  ref: string;
  gitUrl?: string;
  modulePath?: string;
  sourceCommit?: string;
  reason?: string;
  expected?: Record<string, unknown>;
};

export type InstallableAppRevisionApplyInput = {
  workspaceId: string;
  capsuleId: string;
  operation: InstallableAppRevisionOperation;
  expected: Record<string, unknown>;
};

export type InstallableAppUpstreamResponse = {
  status: number;
  body: Record<string, unknown> | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export function resolveInstallableAppAccountsConfig(
  env: InstallableAppInstallEnv,
): InstallableAppAccountsConfig | null {
  const baseUrl =
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
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
  const controlUrl =
    readEnvString(env.TAKOS_APP_INSTALLATIONS_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL);
  const token =
    readEnvString(env.TAKOS_APP_INSTALL_TOKEN) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN);
  const accountId = readEnvString(env.TAKOS_APP_INSTALL_ACCOUNT_ID);
  const configured = Boolean(controlUrl || token || accountId);
  if (!configured) return null;
  return {
    ...(controlUrl
      ? {
          controlUrl: normalizeHttpUrl(
            controlUrl,
            "TAKOS_APP_INSTALLATIONS_URL",
          ),
        }
      : {}),
    ...(token ? { token } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function requireControlUrl(config: InstallableAppInstallConfig): string {
  if (!config.controlUrl) {
    throw new ServiceUnavailableError(
      "Third-party canonical Capsule API is not configured",
    );
  }
  return config.controlUrl;
}

function requireAutomationConfig(config: InstallableAppInstallConfig): {
  controlUrl: string;
  token: string;
} {
  if (!config.controlUrl || !config.token) {
    throw new ServiceUnavailableError(
      "Third-party canonical Capsule automation is not configured",
    );
  }
  return { controlUrl: config.controlUrl, token: config.token };
}

function requireAccountsConfig(
  config: InstallableAppAccountsConfig | null,
): InstallableAppAccountsConfig {
  if (!config) {
    throw new ServiceUnavailableError(
      "Takosumi canonical Capsule API is not configured",
    );
  }
  return config;
}

async function readResponseBody(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return readRecord(parsed) ?? { value: parsed };
  } catch {
    return { error: text.length > 400 ? `${text.slice(0, 400)}...` : text };
  }
}

function requestHeaders(
  config: { token?: string; headers?: HeadersInit },
  json = false,
): Headers {
  const headers = new Headers(config.headers);
  headers.set("accept", "application/json");
  if (json) headers.set("content-type", "application/json");
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }
  return headers;
}

async function fetchControlJson(
  baseUrl: string,
  path: string,
  init: RequestInit,
  config: {
    token?: string;
    headers?: HeadersInit;
    fetch?: InstallableAppFetch;
  },
): Promise<InstallableAppUpstreamResponse> {
  const headers = requestHeaders(
    config,
    init.body !== undefined ||
      init.method === "POST" ||
      init.method === "PATCH",
  );
  for (const [name, value] of new Headers(init.headers))
    headers.set(name, value);
  let response: Response;
  try {
    response = await (config.fetch ?? installableAppInstallDeps.fetch)(
      path ? takosumiSessionApiUrl(baseUrl, path) : new URL(baseUrl),
      { ...init, headers },
    );
  } catch {
    throw new BadGatewayError("Failed to reach Takosumi canonical control API");
  }
  return { status: response.status, body: await readResponseBody(response) };
}

function stableCapsuleName(input: InstallableAppPlanInput): string {
  const candidate =
    input.appId ?? new URL(input.gitUrl).pathname.split("/").pop();
  const normalized = (candidate ?? "app")
    .replace(/\.git$/iu, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized || "app";
}

function sourceName(capsuleName: string): string {
  return `${capsuleName}-source`.slice(0, 64);
}

function requireBodyRecord(
  response: InstallableAppUpstreamResponse,
  field: string,
): Record<string, unknown> {
  if (response.status >= 400) {
    throw new Error(
      `Takosumi ${field} request failed with HTTP ${response.status}`,
    );
  }
  const value = readRecord(response.body?.[field]);
  if (!value) throw new Error(`Takosumi response is missing ${field}`);
  return value;
}

async function listSources(
  workspaceId: string,
  config: InstallableAppInstallConfig,
): Promise<Record<string, unknown>[]> {
  const baseUrl = requireControlUrl(config);
  const url = takosumiSessionApiUrl(baseUrl, takosumiSourcesPath());
  url.searchParams.set("workspaceId", workspaceId);
  const result = await fetchControlJson(
    url.toString(),
    "",
    { method: "GET" },
    config,
  );
  if (result.status >= 400) {
    throw new Error(`canonical Source list failed with HTTP ${result.status}`);
  }
  return Array.isArray(result.body?.sources)
    ? result.body.sources
        .map(readRecord)
        .filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

async function ensureSource(
  input: InstallableAppPlanInput,
  config: InstallableAppInstallConfig,
): Promise<Record<string, unknown>> {
  const baseUrl = requireControlUrl(config);
  const name = sourceName(stableCapsuleName(input));
  const existing = (await listSources(input.workspaceId, config)).find(
    (source) => readString(source.name) === name,
  );
  if (existing) {
    if (readString(existing.workspaceId) !== input.workspaceId) {
      throw new Error("canonical Source belongs to another Workspace");
    }
    if (readString(existing.url) !== input.gitUrl) {
      throw new Error(
        "canonical Source name is already fenced to another Git URL",
      );
    }
    if (
      readString(existing.defaultRef) !== input.ref ||
      readString(existing.defaultPath) !== (input.modulePath ?? ".")
    ) {
      const sourceId = readString(existing.id);
      if (!sourceId) throw new Error("canonical Source is missing id");
      const patched = await fetchControlJson(
        baseUrl,
        takosumiSourcePath(sourceId),
        {
          method: "PATCH",
          body: JSON.stringify({
            defaultRef: input.ref,
            defaultPath: input.modulePath ?? ".",
          }),
        },
        config,
      );
      return requireBodyRecord(patched, "source");
    }
    return existing;
  }
  const result = await fetchControlJson(
    baseUrl,
    takosumiSourcesPath(),
    {
      method: "POST",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        name,
        url: input.gitUrl,
        defaultRef: input.ref,
        defaultPath: input.modulePath ?? ".",
      }),
    },
    config,
  );
  return requireBodyRecord(result, "source");
}

async function listCapsules(
  workspaceId: string,
  config: InstallableAppInstallConfig,
): Promise<Record<string, unknown>[]> {
  const baseUrl = requireControlUrl(config);
  const url = takosumiSessionApiUrl(
    baseUrl,
    takosumiWorkspaceCapsulesPath(workspaceId),
  );
  url.searchParams.set("includeDestroyed", "false");
  const result = await fetchControlJson(
    url.toString(),
    "",
    { method: "GET" },
    config,
  );
  if (result.status >= 400) {
    throw new Error(`canonical Capsule list failed with HTTP ${result.status}`);
  }
  return Array.isArray(result.body?.capsules)
    ? result.body.capsules
        .map(readRecord)
        .filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

async function ensureCapsule(
  input: InstallableAppPlanInput,
  source: Record<string, unknown>,
  config: InstallableAppInstallConfig,
): Promise<Record<string, unknown>> {
  const name = stableCapsuleName(input);
  const existing = (await listCapsules(input.workspaceId, config)).find(
    (capsule) =>
      readString(capsule.name) === name &&
      readString(capsule.environment) === DEFAULT_ENVIRONMENT,
  );
  if (existing) {
    if (
      readString(existing.workspaceId) !== input.workspaceId ||
      readString(existing.sourceId) !== readString(source.id)
    ) {
      throw new Error(
        "canonical Capsule identity is fenced to another Source or Workspace",
      );
    }
    return existing;
  }
  const result = await fetchControlJson(
    requireControlUrl(config),
    takosumiWorkspaceCapsulesPath(input.workspaceId),
    {
      method: "POST",
      body: JSON.stringify({
        name,
        environment: DEFAULT_ENVIRONMENT,
        sourceId: readString(source.id),
        installConfigId: DEFAULT_INSTALL_CONFIG_ID,
        ...(input.modulePath ? { modulePath: input.modulePath } : {}),
        ...(input.variables ? { vars: input.variables } : {}),
      }),
    },
    config,
  );
  return requireBodyRecord(result, "capsule");
}

const SOURCE_SYNC_TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

async function synchronizeSource(
  sourceId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse | null> {
  const baseUrl = requireControlUrl(config);
  const sync = await fetchControlJson(
    baseUrl,
    takosumiSourceSyncPath(sourceId),
    { method: "POST", body: JSON.stringify({ intent: "manual_plan" }) },
    config,
  );
  if (sync.status >= 400) return sync;
  const initialRun = readRecord(sync.body?.run);
  const runId = readString(initialRun?.id);
  if (!runId) throw new Error("source sync response is missing run.id");

  let run = initialRun;
  for (let poll = 0; poll < 80; poll += 1) {
    const status = readString(run?.status);
    if (status && SOURCE_SYNC_TERMINAL_STATUSES.has(status)) {
      if (status === "succeeded") return null;
      return {
        status: 409,
        body: {
          error: "source_sync_failed",
          message: `Source sync Run ${runId} ended with status ${status}`,
          run,
        },
      };
    }
    if (poll > 0) {
      await installableAppInstallDeps.sleep(
        Math.min(1_000 + poll * 100, 3_000),
      );
    }
    const result = await fetchControlJson(
      baseUrl,
      takosumiRunPath(runId),
      { method: "GET" },
      config,
    );
    if (result.status >= 400) return result;
    run = readRecord(result.body?.run);
  }
  return {
    status: 409,
    body: {
      error: "source_sync_required",
      message: "Source contents are still being fetched",
      runId,
    },
  };
}

function exactPlanReference(input: {
  workspaceId: string;
  sourceId?: string;
  capsuleId: string;
  runId: string;
}): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    capsuleId: input.capsuleId,
    runId: input.runId,
  };
}

function exactPlanReferenceFromBody(
  expected: Record<string, unknown>,
  workspaceId: string,
  capsuleId?: string,
): { runId: string; capsuleId: string } {
  const runId = readString(expected.runId);
  const expectedWorkspaceId = readString(expected.workspaceId);
  const expectedCapsuleId = readString(expected.capsuleId);
  if (!runId || !expectedWorkspaceId || !expectedCapsuleId) {
    throw new Error("canonical plan reference is incomplete");
  }
  if (expectedWorkspaceId !== workspaceId) {
    throw new Error("canonical plan reference belongs to another Workspace");
  }
  if (capsuleId && expectedCapsuleId !== capsuleId) {
    throw new Error("canonical plan reference belongs to another Capsule");
  }
  return { runId, capsuleId: expectedCapsuleId };
}

export async function planInstallableAppInstallation(
  input: InstallableAppPlanInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const source = await ensureSource(input, config);
  const sourceId = readString(source.id);
  if (!sourceId) throw new Error("canonical Source is missing id");
  const syncFailure = await synchronizeSource(sourceId, config);
  if (syncFailure) return syncFailure;
  const capsule = await ensureCapsule(input, source, config);
  const capsuleId = readString(capsule.id)!;
  const plan = await fetchControlJson(
    requireControlUrl(config),
    takosumiCapsulePlanPath(capsuleId),
    { method: "POST", body: "{}" },
    config,
  );
  if (plan.status >= 400) return plan;
  const run = readRecord(plan.body?.run);
  const runId = readString(run?.id);
  if (!runId)
    throw new Error("canonical Capsule plan response is missing run.id");
  return {
    status: plan.status,
    body: {
      ...plan.body,
      source,
      capsule,
      expected: exactPlanReference({
        workspaceId: input.workspaceId,
        sourceId,
        capsuleId,
        runId,
      }),
    },
  };
}

export async function applyInstallableAppInstallation(
  input: InstallableAppApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const exact = exactPlanReferenceFromBody(input.expected, input.workspaceId);
  return await fetchControlJson(
    requireControlUrl(config),
    takosumiRunApplyPath(exact.runId),
    { method: "POST", body: "{}" },
    config,
  );
}

async function getCanonicalCapsule(
  capsuleId: string,
  workspaceId: string,
  config: InstallableAppInstallConfig,
): Promise<Record<string, unknown>> {
  const result = await fetchControlJson(
    requireControlUrl(config),
    takosumiCapsulePath(capsuleId),
    { method: "GET" },
    config,
  );
  const capsule = requireBodyRecord(result, "capsule");
  if (readString(capsule.workspaceId) !== workspaceId) {
    throw new Error("canonical Capsule belongs to another Workspace");
  }
  return capsule;
}

export async function planInstallableAppRevision(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const capsule = await getCanonicalCapsule(
    input.capsuleId,
    input.workspaceId,
    config,
  );
  if (input.operation === "rollback") {
    const rollback = await fetchControlJson(
      requireControlUrl(config),
      takosumiStateVersionRollbackPlanPath(input.ref),
      { method: "POST", body: "{}" },
      config,
    );
    if (rollback.status >= 400) return rollback;
    const runId = readString(readRecord(rollback.body?.run)?.id);
    if (!runId) throw new Error("rollback plan response is missing run.id");
    return {
      status: rollback.status,
      body: {
        ...rollback.body,
        expected: exactPlanReference({
          workspaceId: input.workspaceId,
          capsuleId: input.capsuleId,
          runId,
        }),
      },
    };
  }

  const sourceId = readString(capsule.sourceId);
  if (!sourceId) throw new Error("canonical Capsule is missing sourceId");
  const sourceResult = await fetchControlJson(
    requireControlUrl(config),
    takosumiSourcePath(sourceId),
    { method: "GET" },
    config,
  );
  const source = requireBodyRecord(sourceResult, "source");
  if (
    readString(source.workspaceId) !== input.workspaceId ||
    !input.gitUrl ||
    readString(source.url) !== input.gitUrl
  ) {
    throw new Error(
      "canonical Source is fenced to another Workspace or Git URL",
    );
  }
  const patch = await fetchControlJson(
    requireControlUrl(config),
    takosumiSourcePath(sourceId),
    {
      method: "PATCH",
      body: JSON.stringify({
        defaultRef: input.ref,
        defaultPath: input.modulePath ?? ".",
      }),
    },
    config,
  );
  if (patch.status >= 400) return patch;
  const syncFailure = await synchronizeSource(sourceId, config);
  if (syncFailure) return syncFailure;
  const plan = await fetchControlJson(
    requireControlUrl(config),
    takosumiCapsulePlanPath(input.capsuleId),
    { method: "POST", body: "{}" },
    config,
  );
  if (plan.status >= 400) return plan;
  const runId = readString(readRecord(plan.body?.run)?.id);
  if (!runId) throw new Error("revision plan response is missing run.id");
  return {
    status: plan.status,
    body: {
      ...plan.body,
      expected: exactPlanReference({
        workspaceId: input.workspaceId,
        sourceId,
        capsuleId: input.capsuleId,
        runId,
      }),
    },
  };
}

export async function applyInstallableAppRevision(
  input: InstallableAppRevisionApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const exact = exactPlanReferenceFromBody(
    input.expected ?? {},
    input.workspaceId,
    input.capsuleId,
  );
  return await fetchControlJson(
    requireControlUrl(config),
    takosumiRunApplyPath(exact.runId),
    { method: "POST", body: "{}" },
    config,
  );
}

function canonicalStatus(value: unknown): string {
  return readString(value) === "active"
    ? "ready"
    : readString(value) === "pending"
      ? "installing"
      : (readString(value) ?? "unknown");
}

async function sourceForCapsule(
  capsule: Record<string, unknown>,
  config: InstallableAppAccountsConfig,
): Promise<Record<string, unknown> | null> {
  const sourceId = readString(capsule.sourceId);
  if (!sourceId) return null;
  const result = await fetchControlJson(
    config.baseUrl,
    takosumiSourcePath(sourceId),
    { method: "GET" },
    config,
  );
  return result.status < 400 ? readRecord(result.body?.source) : null;
}

function localCapsuleDto(
  capsule: Record<string, unknown>,
  source: Record<string, unknown> | null,
  services?: unknown[],
): Record<string, unknown> {
  const capsuleId = readString(capsule.id);
  return {
    id: capsuleId,
    installation_id: capsuleId,
    app_id: readString(capsule.name),
    name: readString(capsule.name),
    status: canonicalStatus(capsule.status),
    environment: readString(capsule.environment) ?? DEFAULT_ENVIRONMENT,
    runtime_mode: readString(capsule.environment),
    source: source
      ? {
          type: "git",
          url: readString(source.url),
          ref: readString(source.defaultRef),
        }
      : null,
    created_at: readString(capsule.createdAt),
    updated_at: readString(capsule.updatedAt),
    ...(services ? { services } : {}),
  };
}

export async function listInstallableAppInstallations(
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const url = takosumiSessionApiUrl(
    accountsConfig.baseUrl,
    takosumiWorkspaceCapsulesPath(workspaceId),
  );
  url.searchParams.set("includeDestroyed", "false");
  const upstream = await fetchControlJson(
    url.toString(),
    "",
    { method: "GET" },
    accountsConfig,
  );
  if (upstream.status >= 400) return upstream;
  const capsules = Array.isArray(upstream.body?.capsules)
    ? upstream.body.capsules
        .map(readRecord)
        .filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const rows = await Promise.all(
    capsules.map(async (capsule) =>
      localCapsuleDto(capsule, await sourceForCapsule(capsule, accountsConfig)),
    ),
  );
  return { status: upstream.status, body: { installations: rows } };
}

export async function listInstallableAppInstallationsWithServices(
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const upstream = await listInstallableAppInstallations(
    workspaceId,
    accountsConfig,
  );
  if (upstream.status >= 400) return upstream;
  const rows = Array.isArray(upstream.body?.installations)
    ? upstream.body.installations
    : [];
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const record = readRecord(row);
      const capsuleId = readString(record?.id);
      if (!record || !capsuleId) return row;
      const services = await fetchCapsuleWorkloadServices(
        capsuleId,
        workspaceId,
        {
          ...accountsConfig,
        },
      );
      return { ...record, services };
    }),
  );
  return { status: upstream.status, body: { installations: enriched } };
}

export async function listInstallableAppInstallationServices(
  capsuleId: string,
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const capsule = await fetchControlJson(
    accountsConfig.baseUrl,
    takosumiCapsulePath(capsuleId),
    { method: "GET" },
    accountsConfig,
  );
  if (capsule.status >= 400) return capsule;
  if (
    readString(readRecord(capsule.body?.capsule)?.workspaceId) !== workspaceId
  ) {
    return { status: 404, body: { error: "Capsule not found" } };
  }
  const services = await fetchCapsuleWorkloadServices(capsuleId, workspaceId, {
    ...accountsConfig,
  });
  return {
    status: 200,
    body: { installation_id: capsuleId, services },
  };
}

export async function deleteInstallableAppInstallation(
  capsuleId: string,
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
  _reason?: string,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const capsule = await fetchControlJson(
    accountsConfig.baseUrl,
    takosumiCapsulePath(capsuleId),
    { method: "GET" },
    accountsConfig,
  );
  if (capsule.status >= 400) return capsule;
  if (
    readString(readRecord(capsule.body?.capsule)?.workspaceId) !== workspaceId
  ) {
    return { status: 404, body: { error: "Capsule not found" } };
  }
  const destroyed = await fetchControlJson(
    accountsConfig.baseUrl,
    takosumiCapsulePath(capsuleId),
    { method: "DELETE" },
    accountsConfig,
  );
  if (destroyed.status >= 400) return destroyed;
  const runId = readString(readRecord(destroyed.body?.run)?.id);
  if (!runId) return destroyed;
  return await fetchControlJson(
    accountsConfig.baseUrl,
    takosumiRunApplyPath(runId),
    { method: "POST", body: "{}" },
    accountsConfig,
  );
}

/** Explicit operator-only automation config; interactive calls inject OAuth headers. */
export function operatorInstallConfig(
  config: InstallableAppAccountsConfig,
): InstallableAppInstallConfig {
  const { controlUrl, token } = requireAutomationConfig({
    controlUrl: config.baseUrl,
    token: config.token,
  });
  return { controlUrl, token };
}
