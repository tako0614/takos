import {
  BadGatewayError,
  BadRequestError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import type { Env } from "../../../shared/types/index.ts";
import { readEnvString } from "./featured-app-validation.ts";
import {
  fetchCapsuleWorkloadServices,
  projectCapsuleUiSurfaceServices,
  type CapsuleWorkloadServiceSummary,
} from "./takosumi-workload-services.ts";
import {
  takosumiCapsulePath,
  takosumiCapsuleDestroyPlanPath,
  takosumiCapsuleRevisionPlansPath,
  takosumiInstallPlanPath,
  takosumiInstallPlanReconcilePath,
  takosumiRevisionPlanPath,
  takosumiRevisionPlanReconcilePath,
  takosumiRunApprovePath,
  takosumiRunApplyPath,
  takosumiRunPath,
  takosumiSessionApiUrl,
  takosumiSourcesPath,
  takosumiStateVersionRollbackPlanPath,
  takosumiWorkspaceCapsulesPath,
  takosumiWorkspaceInstallPlansPath,
  takosumiWorkspaceUiSurfacesPath,
} from "../takosumi-control-paths.ts";

const DEFAULT_ENVIRONMENT = "production";
const PROJECTION_PAGE_LIMIT = 100;
const INSTALL_PLAN_CREATE_MAX_ATTEMPTS = 3;
const INSTALL_PLAN_RECONCILE_MAX_ATTEMPTS = 12;
const RUN_MUTATION_MAX_ATTEMPTS = 2;
export const TAKOSUMI_GIT_LIFECYCLE_IDEMPOTENCY_KEY_MAX_BYTES = 256;

type InstallableAppInstallEnv = Pick<
  Env,
  | "OIDC_DISCOVERY_URL"
  | "OIDC_ISSUER_URL"
  | "TAKOS_APP_INSTALL_ACCOUNT_ID"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_URL"
>;

export type InstallableAppInstallConfig = {
  controlUrl?: string;
  token?: string;
  idempotencyKey?: string;
  headers?: HeadersInit;
  fetch?: InstallableAppFetch;
  accountId?: string;
};

export type InstallableAppAccountsConfig = {
  baseUrl: string;
  token?: string;
  subjectId?: string;
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
  /** Caller-provided key; every retry must reuse this logical operation key. */
  idempotencyKey?: string;
  authConnectionId?: string;
  deploymentProfileKey?: string;
  providerBindingConnectionIds?: Record<string, string>;
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
  /** Required for upgrade; rollback remains a StateVersion operation. */
  idempotencyKey?: string;
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
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL);
  const token = readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN);
  const accountId = readEnvString(env.TAKOS_APP_INSTALL_ACCOUNT_ID);
  const configured = Boolean(controlUrl || token || accountId);
  if (!configured) return null;
  return {
    ...(controlUrl
      ? {
          controlUrl: normalizeHttpUrl(
            controlUrl,
            "TAKOSUMI_ACCOUNTS_URL",
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

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

function installPlanIdempotencyKey(
  input: { idempotencyKey?: string },
  config: InstallableAppInstallConfig,
): string {
  const key =
    input.idempotencyKey ??
    config.idempotencyKey ??
    headerValue(config.headers, "Idempotency-Key");
  if (!key) {
    throw new BadRequestError(
      "Idempotency-Key is required for a canonical Git lifecycle plan",
    );
  }
  if (
    key.length === 0 ||
    key !== key.trim() ||
    /[\u0000-\u001f\u007f]/u.test(key) ||
    new TextEncoder().encode(key).byteLength >
      TAKOSUMI_GIT_LIFECYCLE_IDEMPOTENCY_KEY_MAX_BYTES
  ) {
    throw new BadRequestError("idempotencyKey must be a bounded header value");
  }
  return key;
}

function assertSecretFreeInstallSourceUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestError("gitUrl must be an absolute Git URL");
  }
  const allowsGitUser = parsed.protocol === "ssh:" && parsed.username === "git";
  if (parsed.password || (parsed.username && !allowsGitUser)) {
    throw new BadRequestError(
      "gitUrl must not include credentials; use authConnectionId",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new BadRequestError(
      "gitUrl must not include query or fragment credential material",
    );
  }
}

function assertInstallPlanInputsAreSecretFree(
  input: InstallableAppPlanInput,
): void {
  if (input.variables && Object.keys(input.variables).length > 0) {
    throw new BadRequestError(
      "variables are not accepted by the canonical install-plan coordinator; declare install inputs in takosumi.json or a deployment profile",
    );
  }
  assertSecretFreeInstallSourceUrl(input.gitUrl);
}

function installPlanCreateBody(
  input: InstallableAppPlanInput,
): Record<string, unknown> {
  const capsuleName = stableCapsuleName(input);
  const source = {
    name: sourceName(capsuleName),
    url: input.gitUrl,
    ref: input.ref,
    path: input.modulePath?.trim() || ".",
    ...(input.authConnectionId
      ? { authConnectionId: input.authConnectionId }
      : {}),
  };
  const capsule = {
    name: capsuleName,
    environment: DEFAULT_ENVIRONMENT,
  };
  const options = {
    ...(input.deploymentProfileKey
      ? { deploymentProfileKey: input.deploymentProfileKey }
      : {}),
    ...(input.providerBindingConnectionIds
      ? { providerBindingConnectionIds: input.providerBindingConnectionIds }
      : {}),
  };
  return { source, capsule, options };
}

function isRetryableInstallPlanCreateStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function createInstallPlan(
  input: InstallableAppPlanInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const idempotencyKey = installPlanIdempotencyKey(input, config);
  const baseUrl = requireControlUrl(config);
  const body = JSON.stringify(installPlanCreateBody(input));
  let lastError: unknown;
  for (let attempt = 0; attempt < INSTALL_PLAN_CREATE_MAX_ATTEMPTS; attempt++) {
    let result: InstallableAppUpstreamResponse;
    try {
      result = await fetchControlJson(
        baseUrl,
        takosumiWorkspaceInstallPlansPath(input.workspaceId),
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        },
        config,
      );
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= INSTALL_PLAN_CREATE_MAX_ATTEMPTS) throw error;
      await installableAppInstallDeps.sleep(Math.min(100 * 2 ** attempt, 500));
      continue;
    }
    if (
      !isRetryableInstallPlanCreateStatus(result.status) ||
      attempt + 1 >= INSTALL_PLAN_CREATE_MAX_ATTEMPTS
    ) {
      return result;
    }
    await installableAppInstallDeps.sleep(Math.min(100 * 2 ** attempt, 500));
  }
  throw lastError instanceof Error
    ? lastError
    : new BadGatewayError("Failed to create Takosumi install plan");
}

function installPlanRecord(
  response: InstallableAppUpstreamResponse,
): Record<string, unknown> {
  const plan = readRecord(response.body?.installPlan);
  if (!plan) throw new Error("Takosumi install-plan response is missing installPlan");
  return plan;
}

function installPlanId(response: InstallableAppUpstreamResponse): string {
  const id = readString(installPlanRecord(response).id);
  if (!id) throw new Error("Takosumi install-plan response is missing id");
  return id;
}

function assertInstallPlanIdentity(
  response: InstallableAppUpstreamResponse,
  expectedId: string,
): void {
  if (installPlanId(response) !== expectedId) {
    throw new Error("Takosumi install-plan response has a different id");
  }
}

function assertInstallPlanWorkspace(
  response: InstallableAppUpstreamResponse,
  expectedWorkspaceId: string,
): void {
  if (readString(installPlanRecord(response).workspaceId) !== expectedWorkspaceId) {
    throw new Error("canonical install plan belongs to another Workspace");
  }
}

function installPlanAction(
  response: InstallableAppUpstreamResponse,
): "reconcile" | "review_run" | "none" {
  const action = readString(response.body?.nextAction);
  if (action === "reconcile" || action === "review_run" || action === "none") {
    return action;
  }
  throw new Error("Takosumi install-plan response has an invalid nextAction");
}

async function readInstallPlan(
  installPlanId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  return await fetchControlJson(
    requireControlUrl(config),
    takosumiInstallPlanPath(installPlanId),
    { method: "GET" },
    config,
  );
}

function failedInstallPlanResponse(
  response: InstallableAppUpstreamResponse,
): InstallableAppUpstreamResponse {
  return {
    status: response.status >= 400 ? response.status : 409,
    body: {
      ...(response.body ?? {}),
      error: "install_plan_failed",
      message: "Takosumi could not produce a reviewable install Run",
    },
  };
}

function timedOutInstallPlanResponse(
  response: InstallableAppUpstreamResponse,
): InstallableAppUpstreamResponse {
  return {
    status: 409,
    body: {
      ...(response.body ?? {}),
      error: "install_plan_timeout",
      message: "Takosumi install plan did not reach a reviewable Run in time",
    },
  };
}

function installPlanSourceRecord(
  plan: Record<string, unknown>,
  workspaceId: string,
  sourceId: string,
): Record<string, unknown> {
  const source = readRecord(plan.source) ?? {};
  return {
    id: sourceId,
    workspaceId,
    name: readString(source.name),
    url: readString(source.url),
    defaultRef: readString(source.ref),
    defaultPath: readString(source.path),
    ...(readString(source.authConnectionId)
      ? { authConnectionId: readString(source.authConnectionId) }
      : {}),
  };
}

function installPlanCapsuleRecord(
  plan: Record<string, unknown>,
  workspaceId: string,
  sourceId: string,
  capsuleId: string,
): Record<string, unknown> {
  const capsule = readRecord(plan.capsule) ?? {};
  return {
    id: capsuleId,
    workspaceId,
    sourceId,
    name: readString(capsule.name),
    environment: readString(capsule.environment) ?? DEFAULT_ENVIRONMENT,
  };
}

async function reviewInstallPlanRun(
  response: InstallableAppUpstreamResponse,
  initialStatus: number,
  workspaceId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const plan = installPlanRecord(response);
  const planWorkspaceId = readString(plan.workspaceId);
  if (planWorkspaceId !== workspaceId) {
    throw new Error("canonical install plan belongs to another Workspace");
  }
  const sourceId = readString(plan.sourceId);
  const capsuleId = readString(plan.capsuleId);
  const planRunId = readString(plan.planRunId);
  if (!sourceId || !capsuleId || !planRunId) {
    throw new Error(
      "canonical install plan is reviewable without exact Source, Capsule, and Run references",
    );
  }
  const runResponse = await fetchControlJson(
    requireControlUrl(config),
    takosumiRunPath(planRunId),
    { method: "GET" },
    config,
  );
  if (runResponse.status >= 400) return runResponse;
  const run = readRecord(runResponse.body?.run);
  if (!run) throw new Error("canonical Run response is missing run");
  if (readString(run.id) !== planRunId) {
    throw new Error("canonical Run reference does not match install plan");
  }
  if (readString(run.workspaceId) !== workspaceId) {
    throw new Error("canonical Run belongs to another Workspace");
  }
  if (readString(run.capsuleId) !== capsuleId) {
    throw new Error("canonical Run belongs to another Capsule");
  }
  if (run.sourceId !== undefined && readString(run.sourceId) !== sourceId) {
    throw new Error("canonical Run belongs to another Source");
  }
  const sourceSnapshotId = readString(plan.sourceSnapshotId);
  if (
    sourceSnapshotId &&
    run.sourceSnapshotId !== undefined &&
    readString(run.sourceSnapshotId) !== sourceSnapshotId
  ) {
    throw new Error("canonical Run uses another Source snapshot");
  }
  const expected = exactPlanReference({
    workspaceId,
    sourceId,
    capsuleId,
    runId: planRunId,
  });
  return {
    status: initialStatus,
    body: {
      ...(response.body ?? {}),
      run,
      source: installPlanSourceRecord(plan, workspaceId, sourceId),
      capsule: installPlanCapsuleRecord(
        plan,
        workspaceId,
        sourceId,
        capsuleId,
      ),
      expected,
    },
  };
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
  const runId = readString(expected.runId) ?? readString(expected.planRunId);
  const planRunId = readString(expected.planRunId);
  const expectedWorkspaceId = readString(expected.workspaceId);
  const expectedCapsuleId = readString(expected.capsuleId);
  if (!runId || !expectedWorkspaceId || !expectedCapsuleId) {
    throw new Error("canonical plan reference is incomplete");
  }
  if (planRunId && planRunId !== runId) {
    throw new Error("canonical plan reference has conflicting Run references");
  }
  if (expectedWorkspaceId !== workspaceId) {
    throw new Error("canonical plan reference belongs to another Workspace");
  }
  if (capsuleId && expectedCapsuleId !== capsuleId) {
    throw new Error("canonical plan reference belongs to another Capsule");
  }
  return { runId, capsuleId: expectedCapsuleId };
}

type ExactPlanReference = ReturnType<typeof exactPlanReferenceFromBody>;

function assertExactCanonicalRun(
  response: InstallableAppUpstreamResponse,
  exact: ExactPlanReference,
  workspaceId: string,
): Record<string, unknown> {
  const run = readRecord(response.body?.run);
  if (!run) throw new Error("canonical Run response is missing run");
  if (readString(run.id) !== exact.runId) {
    throw new Error("canonical Run response has another Run id");
  }
  if (readString(run.workspaceId) !== workspaceId) {
    throw new Error("canonical Run belongs to another Workspace");
  }
  if (readString(run.capsuleId) !== exact.capsuleId) {
    throw new Error("canonical Run belongs to another Capsule");
  }
  return run;
}

async function readExactCanonicalRun(
  exact: ExactPlanReference,
  workspaceId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const response = await fetchControlJson(
    requireControlUrl(config),
    takosumiRunPath(exact.runId),
    { method: "GET" },
    config,
  );
  if (response.status < 400) {
    assertExactCanonicalRun(response, exact, workspaceId);
  }
  return response;
}

function runNotApplyableResponse(
  exact: ExactPlanReference,
  status: string,
  approvalRequired: boolean,
): InstallableAppUpstreamResponse {
  return {
    status: 409,
    body: {
      error: {
        code: "failed_precondition",
        message: approvalRequired
          ? `canonical Run ${exact.runId} is waiting_approval; delegated interactive approval is required`
          : `canonical Run ${exact.runId} is ${status}; only succeeded Runs can apply`,
      },
    },
  };
}

async function postIdempotentRunMutation(
  path: string,
  operation: "approval" | "apply",
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RUN_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchControlJson(
        requireControlUrl(config),
        path,
        { method: "POST", body: "{}" },
        config,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw new BadGatewayError(
    `Takosumi Run ${operation} outcome is indeterminate after a bounded idempotent replay${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function applyExactCanonicalRun(
  exact: ExactPlanReference,
  workspaceId: string,
  config: InstallableAppInstallConfig,
  approveWaitingRun: boolean,
): Promise<InstallableAppUpstreamResponse> {
  const observed = await readExactCanonicalRun(exact, workspaceId, config);
  if (observed.status >= 400) return observed;
  const observedStatus = readString(
    assertExactCanonicalRun(observed, exact, workspaceId).status,
  );

  if (observedStatus === "waiting_approval") {
    if (!approveWaitingRun) {
      return runNotApplyableResponse(exact, observedStatus, true);
    }

    let approved: InstallableAppUpstreamResponse | undefined;
    let approvalTransportError: unknown;
    try {
      approved = await postIdempotentRunMutation(
        takosumiRunApprovePath(exact.runId),
        "approval",
        config,
      );
      if (approved.status < 400) {
        assertExactCanonicalRun(approved, exact, workspaceId);
      }
    } catch (error) {
      approvalTransportError = error;
    }

    // The approve endpoint is idempotent, but a response can still be lost or
    // a concurrent approver can win its CAS. Re-read the exact Run before any
    // apply so only the authoritative succeeded projection clears the gate.
    const afterApproval = await readExactCanonicalRun(
      exact,
      workspaceId,
      config,
    );
    if (afterApproval.status >= 400) {
      if (approvalTransportError) throw approvalTransportError;
      return afterApproval;
    }
    const afterApprovalStatus = readString(
      assertExactCanonicalRun(afterApproval, exact, workspaceId).status,
    );
    if (afterApprovalStatus !== "succeeded") {
      if (approvalTransportError) throw approvalTransportError;
      if (approved && approved.status >= 400) return approved;
      return runNotApplyableResponse(
        exact,
        afterApprovalStatus ?? "unknown",
        true,
      );
    }
  } else if (observedStatus !== "succeeded") {
    return runNotApplyableResponse(
      exact,
      observedStatus ?? "unknown",
      false,
    );
  }

  return await postIdempotentRunMutation(
    takosumiRunApplyPath(exact.runId),
    "apply",
    config,
  );
}

export async function planInstallableAppCapsule(
  input: InstallableAppPlanInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  assertInstallPlanInputsAreSecretFree(input);
  const created = await createInstallPlan(input, config);
  if (created.status >= 400) return created;
  const createdPlanId = installPlanId(created);
  assertInstallPlanWorkspace(created, input.workspaceId);
  let observed = await readInstallPlan(createdPlanId, config);
  if (observed.status >= 400) return observed;
  assertInstallPlanIdentity(observed, createdPlanId);
  assertInstallPlanWorkspace(observed, input.workspaceId);

  for (
    let attempt = 0;
    attempt < INSTALL_PLAN_RECONCILE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const action = installPlanAction(observed);
    if (action === "review_run") {
      return await reviewInstallPlanRun(
        observed,
        created.status,
        input.workspaceId,
        config,
      );
    }
    if (action === "none") return failedInstallPlanResponse(observed);

    const reconciled = await fetchControlJson(
      requireControlUrl(config),
      takosumiInstallPlanReconcilePath(createdPlanId),
      { method: "POST", body: "{}" },
      config,
    );
    if (reconciled.status >= 400) return reconciled;
    assertInstallPlanIdentity(reconciled, createdPlanId);
    assertInstallPlanWorkspace(reconciled, input.workspaceId);
    observed = reconciled;
    if (installPlanAction(observed) === "review_run") {
      return await reviewInstallPlanRun(
        observed,
        created.status,
        input.workspaceId,
        config,
      );
    }
    if (installPlanAction(observed) === "none") {
      return failedInstallPlanResponse(observed);
    }
    if (attempt + 1 >= INSTALL_PLAN_RECONCILE_MAX_ATTEMPTS) break;
    await installableAppInstallDeps.sleep(Math.min(50 * (attempt + 1), 250));
    observed = await readInstallPlan(createdPlanId, config);
    if (observed.status >= 400) return observed;
    assertInstallPlanIdentity(observed, createdPlanId);
    assertInstallPlanWorkspace(observed, input.workspaceId);
  }
  return timedOutInstallPlanResponse(observed);
}

export async function applyInstallableAppCapsule(
  input: InstallableAppApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const exact = exactPlanReferenceFromBody(input.expected, input.workspaceId);
  return await applyExactCanonicalRun(
    exact,
    input.workspaceId,
    config,
    false,
  );
}

export async function approveAndApplyInstallableAppCapsule(
  input: InstallableAppApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const exact = exactPlanReferenceFromBody(input.expected, input.workspaceId);
  return await applyExactCanonicalRun(exact, input.workspaceId, config, true);
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
  if (
    readString(capsule.id) !== capsuleId ||
    readString(capsule.workspaceId) !== workspaceId
  ) {
    throw new Error("canonical Capsule identity does not match this Workspace");
  }
  return capsule;
}

function revisionPlanRecord(
  response: InstallableAppUpstreamResponse,
): Record<string, unknown> {
  const plan = readRecord(response.body?.revisionPlan);
  if (!plan) {
    throw new Error("Takosumi revision-plan response is missing revisionPlan");
  }
  if (readString(plan.operation) !== "revision") {
    throw new Error("Takosumi revision-plan response has another operation");
  }
  return plan;
}

function revisionPlanId(response: InstallableAppUpstreamResponse): string {
  const id = readString(revisionPlanRecord(response).id);
  if (!id) throw new Error("Takosumi revision-plan response is missing id");
  return id;
}

function assertRevisionPlanAuthority(
  response: InstallableAppUpstreamResponse,
  expected: { id: string; workspaceId: string; capsuleId: string },
): void {
  const plan = revisionPlanRecord(response);
  if (readString(plan.id) !== expected.id) {
    throw new Error("Takosumi revision-plan response has a different id");
  }
  if (readString(plan.workspaceId) !== expected.workspaceId) {
    throw new Error("canonical revision plan belongs to another Workspace");
  }
  if (readString(plan.capsuleId) !== expected.capsuleId) {
    throw new Error("canonical revision plan belongs to another Capsule");
  }
  if (!readString(plan.sourceId) || !readString(plan.installConfigId)) {
    throw new Error("canonical revision plan is missing pinned source authority");
  }
}

function revisionPlanAction(
  response: InstallableAppUpstreamResponse,
): "reconcile" | "review_run" | "none" {
  const action = readString(response.body?.nextAction);
  if (action === "reconcile" || action === "review_run" || action === "none") {
    return action;
  }
  throw new Error("Takosumi revision-plan response has an invalid nextAction");
}

async function createRevisionPlan(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const idempotencyKey = installPlanIdempotencyKey(input, config);
  const body = JSON.stringify({ ref: input.ref });
  let lastError: unknown;
  for (let attempt = 0; attempt < INSTALL_PLAN_CREATE_MAX_ATTEMPTS; attempt++) {
    let result: InstallableAppUpstreamResponse;
    try {
      result = await fetchControlJson(
        requireControlUrl(config),
        takosumiCapsuleRevisionPlansPath(input.capsuleId),
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body,
        },
        config,
      );
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= INSTALL_PLAN_CREATE_MAX_ATTEMPTS) throw error;
      await installableAppInstallDeps.sleep(Math.min(100 * 2 ** attempt, 500));
      continue;
    }
    if (
      !isRetryableInstallPlanCreateStatus(result.status) ||
      attempt + 1 >= INSTALL_PLAN_CREATE_MAX_ATTEMPTS
    ) {
      return result;
    }
    await installableAppInstallDeps.sleep(Math.min(100 * 2 ** attempt, 500));
  }
  throw lastError instanceof Error
    ? lastError
    : new BadGatewayError("Failed to create Takosumi revision plan");
}

async function readRevisionPlan(
  revisionPlanId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  return await fetchControlJson(
    requireControlUrl(config),
    takosumiRevisionPlanPath(revisionPlanId),
    { method: "GET" },
    config,
  );
}

function failedRevisionPlanResponse(
  response: InstallableAppUpstreamResponse,
): InstallableAppUpstreamResponse {
  return {
    status: response.status >= 400 ? response.status : 409,
    body: {
      ...(response.body ?? {}),
      error: "revision_plan_failed",
      message: "Takosumi could not produce a reviewable revision Run",
    },
  };
}

function timedOutRevisionPlanResponse(
  response: InstallableAppUpstreamResponse,
): InstallableAppUpstreamResponse {
  return {
    status: 409,
    body: {
      ...(response.body ?? {}),
      error: "revision_plan_timeout",
      message: "Takosumi revision plan did not reach a reviewable Run in time",
    },
  };
}

async function reviewRevisionPlanRun(
  response: InstallableAppUpstreamResponse,
  initialStatus: number,
  workspaceId: string,
  capsuleId: string,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const plan = revisionPlanRecord(response);
  const planRunId = readString(plan.planRunId);
  const sourceId = readString(plan.sourceId);
  if (!planRunId || !sourceId) {
    throw new Error(
      "canonical revision plan is reviewable without exact Source and Run references",
    );
  }
  const runResponse = await fetchControlJson(
    requireControlUrl(config),
    takosumiRunPath(planRunId),
    { method: "GET" },
    config,
  );
  if (runResponse.status >= 400) return runResponse;
  const run = readRecord(runResponse.body?.run);
  if (!run) throw new Error("canonical Run response is missing run");
  if (readString(run.id) !== planRunId) {
    throw new Error("canonical Run reference does not match revision plan");
  }
  if (readString(run.workspaceId) !== workspaceId) {
    throw new Error("canonical Run belongs to another Workspace");
  }
  if (readString(run.capsuleId) !== capsuleId) {
    throw new Error("canonical Run belongs to another Capsule");
  }
  if (run.sourceId !== undefined && readString(run.sourceId) !== sourceId) {
    throw new Error("canonical Run belongs to another Source");
  }
  return {
    status: initialStatus,
    body: {
      ...(response.body ?? {}),
      run,
      source: installPlanSourceRecord(plan, workspaceId, sourceId),
      capsule: installPlanCapsuleRecord(
        plan,
        workspaceId,
        sourceId,
        capsuleId,
      ),
      expected: exactPlanReference({
        workspaceId,
        sourceId,
        capsuleId,
        runId: planRunId,
      }),
    },
  };
}

async function planInstallableAppUpgrade(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const created = await createRevisionPlan(input, config);
  if (created.status >= 400) return created;
  const createdPlanId = revisionPlanId(created);
  const authority = {
    id: createdPlanId,
    workspaceId: input.workspaceId,
    capsuleId: input.capsuleId,
  };
  assertRevisionPlanAuthority(created, authority);
  let observed = await readRevisionPlan(createdPlanId, config);
  if (observed.status >= 400) return observed;
  assertRevisionPlanAuthority(observed, authority);

  for (
    let attempt = 0;
    attempt < INSTALL_PLAN_RECONCILE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const action = revisionPlanAction(observed);
    if (action === "review_run") {
      return await reviewRevisionPlanRun(
        observed,
        created.status,
        input.workspaceId,
        input.capsuleId,
        config,
      );
    }
    if (action === "none") return failedRevisionPlanResponse(observed);

    const reconciled = await fetchControlJson(
      requireControlUrl(config),
      takosumiRevisionPlanReconcilePath(createdPlanId),
      { method: "POST", body: "{}" },
      config,
    );
    if (reconciled.status >= 400) return reconciled;
    assertRevisionPlanAuthority(reconciled, authority);
    observed = reconciled;
    if (revisionPlanAction(observed) === "review_run") {
      return await reviewRevisionPlanRun(
        observed,
        created.status,
        input.workspaceId,
        input.capsuleId,
        config,
      );
    }
    if (revisionPlanAction(observed) === "none") {
      return failedRevisionPlanResponse(observed);
    }
    if (attempt + 1 >= INSTALL_PLAN_RECONCILE_MAX_ATTEMPTS) break;
    await installableAppInstallDeps.sleep(Math.min(50 * (attempt + 1), 250));
    observed = await readRevisionPlan(createdPlanId, config);
    if (observed.status >= 400) return observed;
    assertRevisionPlanAuthority(observed, authority);
  }
  return timedOutRevisionPlanResponse(observed);
}

export async function planInstallableAppRevision(
  input: InstallableAppRevisionInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  if (input.operation === "upgrade") {
    return await planInstallableAppUpgrade(input, config);
  }
  if (input.operation === "rollback") {
    await getCanonicalCapsule(input.capsuleId, input.workspaceId, config);
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

  throw new BadRequestError("unsupported Capsule revision operation");
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
  return await applyExactCanonicalRun(
    exact,
    input.workspaceId,
    config,
    false,
  );
}

export async function approveAndApplyInstallableAppRevision(
  input: InstallableAppRevisionApplyInput,
  config: InstallableAppInstallConfig,
): Promise<InstallableAppUpstreamResponse> {
  const exact = exactPlanReferenceFromBody(
    input.expected ?? {},
    input.workspaceId,
    input.capsuleId,
  );
  return await applyExactCanonicalRun(exact, input.workspaceId, config, true);
}

function canonicalStatus(value: unknown): string {
  return readString(value) ?? "unknown";
}

function localCapsuleDto(
  capsule: Record<string, unknown>,
  source: Record<string, unknown> | null,
  services?: readonly unknown[],
): Record<string, unknown> {
  const capsuleId = readString(capsule.id);
  return {
    capsule_id: capsuleId,
    app_id: readString(capsule.name),
    name: readString(capsule.name),
    status: canonicalStatus(capsule.status),
    environment: readString(capsule.environment) ?? DEFAULT_ENVIRONMENT,
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

async function workspaceSourcesPage(
  workspaceId: string,
  config: InstallableAppAccountsConfig,
): Promise<InstallableAppUpstreamResponse> {
  const url = takosumiSessionApiUrl(config.baseUrl, takosumiSourcesPath());
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("limit", String(PROJECTION_PAGE_LIMIT));
  return await fetchControlJson(
    url.toString(),
    "",
    { method: "GET" },
    config,
  );
}

async function workspaceUiSurfacesPage(
  workspaceId: string,
  config: InstallableAppAccountsConfig,
): Promise<InstallableAppUpstreamResponse> {
  const url = takosumiSessionApiUrl(
    config.baseUrl,
    takosumiWorkspaceUiSurfacesPath(workspaceId),
  );
  url.searchParams.set("limit", String(PROJECTION_PAGE_LIMIT));
  return await fetchControlJson(
    url.toString(),
    "",
    { method: "GET" },
    config,
  );
}

function sourcesById(
  body: Record<string, unknown> | null,
  workspaceId: string,
): Map<string, Record<string, unknown>> {
  const sources = Array.isArray(body?.sources) ? body.sources : [];
  const entries = sources.flatMap((value) => {
    const source = readRecord(value);
    const id = readString(source?.id);
    return source &&
        id &&
        readString(source.workspaceId) === workspaceId
      ? [[id, source] as const]
      : [];
  });
  return new Map(entries);
}

function servicesByCapsuleId(
  body: Record<string, unknown> | null,
  workspaceId: string,
): Map<string, CapsuleWorkloadServiceSummary[]> {
  const grouped = new Map<string, CapsuleWorkloadServiceSummary[]>();
  for (const projected of projectCapsuleUiSurfaceServices(body, workspaceId)) {
    const services = grouped.get(projected.capsuleId) ?? [];
    services.push(projected.service);
    grouped.set(projected.capsuleId, services);
  }
  for (const services of grouped.values()) {
    services.sort(
      (left, right) =>
        left.capability.localeCompare(right.capability) ||
        left.id.localeCompare(right.id),
    );
  }
  return grouped;
}

async function listInstallableAppCapsuleProjection(
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
  includeServices: boolean,
): Promise<InstallableAppUpstreamResponse> {
  const accountsConfig = requireAccountsConfig(config);
  const url = takosumiSessionApiUrl(
    accountsConfig.baseUrl,
    takosumiWorkspaceCapsulesPath(workspaceId),
  );
  url.searchParams.set("includeDestroyed", "false");
  url.searchParams.set("limit", String(PROJECTION_PAGE_LIMIT));
  const [capsulePage, sourcePage, uiSurfacePage] = await Promise.all([
    fetchControlJson(
      url.toString(),
      "",
      { method: "GET" },
      accountsConfig,
    ),
    workspaceSourcesPage(workspaceId, accountsConfig),
    includeServices
      ? workspaceUiSurfacesPage(workspaceId, accountsConfig)
      : Promise.resolve({
          status: 200,
          body: { interfaces: [] },
        } satisfies InstallableAppUpstreamResponse),
  ]);
  if (capsulePage.status >= 400) return capsulePage;
  const capsules = Array.isArray(capsulePage.body?.capsules)
    ? capsulePage.body.capsules
        .map(readRecord)
        .filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const sourceIndex =
    sourcePage.status < 400
      ? sourcesById(sourcePage.body, workspaceId)
      : new Map<string, Record<string, unknown>>();
  const serviceIndex =
    includeServices && uiSurfacePage.status < 400
      ? servicesByCapsuleId(uiSurfacePage.body, workspaceId)
      : new Map<string, CapsuleWorkloadServiceSummary[]>();
  const rows = capsules.map((capsule) => {
    const capsuleId = readString(capsule.id);
    const sourceId = readString(capsule.sourceId);
    return localCapsuleDto(
      capsule,
      sourceId ? (sourceIndex.get(sourceId) ?? null) : null,
      includeServices && capsuleId
        ? (serviceIndex.get(capsuleId) ?? [])
        : undefined,
    );
  });
  const nextCursor = readString(capsulePage.body?.nextCursor);
  return {
    status: capsulePage.status,
    body: {
      capsules: rows,
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
}

export async function listInstallableAppCapsules(
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  return await listInstallableAppCapsuleProjection(
    workspaceId,
    config,
    false,
  );
}

export async function listInstallableAppCapsulesWithServices(
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
): Promise<InstallableAppUpstreamResponse> {
  return await listInstallableAppCapsuleProjection(
    workspaceId,
    config,
    true,
  );
}

export async function listInstallableAppCapsuleServices(
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
    body: { capsule_id: capsuleId, services },
  };
}

export async function deleteInstallableAppCapsule(
  capsuleId: string,
  workspaceId: string,
  config: InstallableAppAccountsConfig | null,
  reason?: string,
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
  const planned = await fetchControlJson(
    accountsConfig.baseUrl,
    takosumiCapsuleDestroyPlanPath(capsuleId),
    {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    },
    accountsConfig,
  );
  if (planned.status >= 400) return planned;
  const run = readRecord(planned.body?.run);
  const runId = readString(run?.id);
  if (!runId) {
    throw new Error("canonical destroy plan response is missing run.id");
  }
  if (
    readString(run?.workspaceId) !== workspaceId ||
    readString(run?.capsuleId) !== capsuleId
  ) {
    throw new Error("canonical destroy plan belongs to another Workspace or Capsule");
  }
  return {
    // DELETE is a plan-producing asynchronous facade even though the
    // canonical destroy-plan endpoint itself returns 201.
    status: 202,
    body: {
      ...(planned.body ?? {}),
      expected: exactPlanReference({
        workspaceId,
        capsuleId,
        runId,
      }),
    },
  };
}
