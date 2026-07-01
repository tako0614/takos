import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  BadRequestError,
  AuthenticationError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import {
  TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH,
  TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
} from "@takosjp/takosumi-accounts-contract";

import {
  applyDefaultAppInstallation,
  type DefaultAppDistributionEntry,
  resolveDefaultAppDistributionForBootstrap,
  resolveDefaultAppInstallConfig,
} from "../../application/services/source/default-app-distribution.ts";
import {
  applyInstallableAppInstallation,
  applyInstallableAppRevision,
  deleteInstallableAppInstallation,
  planInstallableAppInstallation,
  planInstallableAppRevision,
  type InstallableAppRevisionOperation,
  type InstallableAppUpstreamResponse,
  listInstallableAppInstallationServices,
  listInstallableAppInstallations,
  listInstallableAppInstallationsWithServices,
  resolveInstallableAppAccountsConfig,
  resolveInstallableAppInstallConfig,
} from "../../application/services/source/installable-app-install.ts";
import {
  installationProjectionToServicesBody,
  projectWorkloadServicesFromInstallationBody,
} from "../../application/services/source/takosumi-workload-services.ts";
import {
  parseJsonBody,
  spaceAccess,
  type SpaceAccessRouteEnv,
} from "./route-auth.ts";
import {
  handleAccountsPlaneRequest,
  type CloudflareWorkerEnv as AccountsWorkerEnv,
} from "./accounts/mount.ts";

type InstallableAppApplyBody = {
  app_id?: unknown;
  git_url?: unknown;
  ref?: unknown;
  path?: unknown;
  module_path?: unknown;
  modulePath?: unknown;
  mode?: unknown;
  runtime_base_url?: unknown;
  source_commit?: unknown;
  expected_commit?: unknown;
  expected_plan_digest?: unknown;
  expected_current_deployment_id?: unknown;
  expected?: unknown;
  variables?: unknown;
  vars?: unknown;
  installation_id?: unknown;
  operation?: unknown;
  reason?: unknown;
  cost_ack?: unknown;
};

type InstallationApiRecord = {
  installed: true;
  installation_id: string | null;
  app_id: string;
  status: string;
  runtime_mode: string | null;
  installed_version: string | null;
  installed_commit: string | null;
  installed_at: string;
  updated_at: string;
  group_id: null;
  group_name: null;
  deployed_at: null;
};

export const appInstallationsRouteDeps = {
  applyDefaultAppInstallation,
  resolveDefaultAppDistributionForBootstrap,
  resolveDefaultAppInstallConfig,
  resolveInstallableAppAccountsConfig,
  resolveInstallableAppInstallConfig,
  listInstallableAppInstallations,
  deleteInstallableAppInstallation,
  planInstallableAppInstallation,
  applyInstallableAppInstallation,
  planInstallableAppRevision,
  applyInstallableAppRevision,
  listInstallableAppInstallationsWithServices,
  listInstallableAppInstallationServices,
  handleAccountsPlaneRequest,
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBodyAppId(body: InstallableAppApplyBody): string {
  const appId = readOptionalBodyAppId(body);
  if (!appId) {
    throw new BadRequestError("app_id is required");
  }
  return appId;
}

function readOptionalBodyAppId(body: InstallableAppApplyBody): string | null {
  return readString(body.app_id);
}

function readBodyMode(
  body: InstallableAppApplyBody,
  entry: DefaultAppDistributionEntry,
): string | undefined {
  const mode = readString(body.mode);
  if (!mode) return undefined;
  if (!(entry.runtimeModes as readonly string[] | undefined)?.includes(mode)) {
    throw new BadRequestError(
      `mode is not supported by ${entry.appId ?? entry.name}`,
    );
  }
  return mode;
}

function readBodyInstallSource(body: InstallableAppApplyBody): {
  gitUrl: string;
  ref: string;
  modulePath?: string;
} | null {
  const gitUrl = readString(body.git_url);
  const ref = readString(body.ref);
  const modulePath = readOptionalBodyModulePath(body);
  const hasPartialSource = Boolean(gitUrl || ref || modulePath);
  if (!hasPartialSource) return null;
  if (!gitUrl || !ref) {
    throw new BadRequestError("git_url and ref are required");
  }
  assertBrowserGitUrl(gitUrl);
  return {
    gitUrl,
    ref,
    ...(modulePath ? { modulePath } : {}),
  };
}

function readRequiredInstallationId(body: InstallableAppApplyBody): string {
  const installationId = readString(body.installation_id);
  if (!installationId) {
    throw new BadRequestError("installation_id is required");
  }
  return installationId;
}

function readBodyRevisionOperation(
  body: InstallableAppApplyBody,
): InstallableAppRevisionOperation {
  const value = readString(body.operation);
  if (value === "upgrade" || value === "rollback") return value;
  throw new BadRequestError("operation must be upgrade or rollback");
}

function assertBrowserGitUrl(gitUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    throw new BadRequestError("git_url must be an HTTPS Git URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new BadRequestError(
      "git_url must be an HTTPS Git URL without credentials",
    );
  }
}

function readOptionalBodyModulePath(
  body: InstallableAppApplyBody,
): string | undefined {
  const modulePath =
    readString(body.modulePath) ??
    readString(body.module_path) ??
    readString(body.path);
  if (!modulePath) return undefined;
  assertSafeModulePath(modulePath);
  return modulePath;
}

function assertSafeModulePath(modulePath: string): void {
  if (
    modulePath.startsWith("/") ||
    modulePath.split("/").some((part) => part === "..")
  ) {
    throw new BadRequestError(
      "module_path must be a repository-relative OpenTofu module directory",
    );
  }
}

function readOptionalBodyMode(
  body: InstallableAppApplyBody,
): string | undefined {
  return readString(body.mode) ?? undefined;
}

function readOptionalBodyRuntimeBaseUrl(
  body: InstallableAppApplyBody,
): string | undefined {
  return readString(body.runtime_base_url) ?? undefined;
}

function readOptionalBodyVariables(
  body: InstallableAppApplyBody,
): Record<string, unknown> | undefined {
  return readRecord(body.variables) ?? readRecord(body.vars) ?? undefined;
}

function readOptionalBodyBoolean(
  body: InstallableAppApplyBody,
  field: "cost_ack",
): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new BadRequestError(`${field} must be a boolean`);
  }
  return value;
}

function jsonFromUpstream(
  c: Context<SpaceAccessRouteEnv>,
  result: InstallableAppUpstreamResponse,
): Response {
  return c.json(result.body, result.status as ContentfulStatusCode);
}

const TAKOSUMI_ACCOUNTS_SESSION_ME_PATH = "/v1/account/session/me";
const TAKOSUMI_ACCOUNTS_SESSION_COOKIE_NAME = "takosumi_session";

type AccountsSessionCaller = {
  kind: "accounts_session";
  subject: string;
  headers: Headers;
};

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function hasAccountsSessionCookie(cookie: string | undefined): boolean {
  if (!cookie) return false;
  return cookie.split(";").some((part) => {
    const [name] = part.trim().split("=", 1);
    return name === TAKOSUMI_ACCOUNTS_SESSION_COOKIE_NAME;
  });
}

function readAccountsSessionHeader(c: Context<SpaceAccessRouteEnv>): {
  present: boolean;
  headers: Headers;
} {
  const headers = new Headers({ accept: "application/json" });
  let present = false;
  const bearer = bearerToken(c.req.header("Authorization"));
  if (bearer?.startsWith("sess_")) {
    headers.set("authorization", `Bearer ${bearer}`);
    present = true;
  }
  const explicitSession = readString(
    c.req.header("x-takosumi-account-session"),
  );
  if (explicitSession?.startsWith("sess_")) {
    headers.set("x-takosumi-account-session", explicitSession);
    present = true;
  }
  const cookie = c.req.header("Cookie");
  if (hasAccountsSessionCookie(cookie)) {
    headers.set("cookie", cookie ?? "");
    present = true;
  }
  return { present, headers };
}

async function readUpstreamBody(
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

async function accountsPlaneJson(
  c: Context<SpaceAccessRouteEnv>,
  path: string,
  init: RequestInit,
): Promise<InstallableAppUpstreamResponse> {
  const url = new URL(c.req.url);
  url.pathname = path;
  url.search = "";
  const request = new Request(url.toString(), init);
  const response = await appInstallationsRouteDeps.handleAccountsPlaneRequest(
    request,
    c.env as unknown as AccountsWorkerEnv,
  );
  return {
    status: response.status,
    body: await readUpstreamBody(response),
  };
}

async function accountsPlaneGetJson(
  c: Context<SpaceAccessRouteEnv>,
  path: string,
  headers: Headers,
  search?: Record<string, string>,
): Promise<InstallableAppUpstreamResponse> {
  const url = new URL(c.req.url);
  url.pathname = path;
  url.search = "";
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await appInstallationsRouteDeps.handleAccountsPlaneRequest(
    new Request(url.toString(), { method: "GET", headers }),
    c.env as unknown as AccountsWorkerEnv,
  );
  return {
    status: response.status,
    body: await readUpstreamBody(response),
  };
}

function jsonHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  next.set("accept", "application/json");
  next.set("content-type", "application/json");
  return next;
}

async function resolveAccountsSessionCaller(
  c: Context<SpaceAccessRouteEnv>,
): Promise<AccountsSessionCaller | null> {
  const session = readAccountsSessionHeader(c);
  if (!session.present) return null;
  const response = await accountsPlaneJson(
    c,
    TAKOSUMI_ACCOUNTS_SESSION_ME_PATH,
    {
      method: "GET",
      headers: session.headers,
    },
  );
  if (response.status !== 200) {
    throw new AuthenticationError("Takosumi Accounts session is required");
  }
  const subject = readString(response.body?.subject);
  if (!subject) {
    throw new AuthenticationError("Takosumi Accounts session is invalid");
  }
  return {
    kind: "accounts_session",
    subject,
    headers: session.headers,
  };
}

function accountsInstallationsPath(installationId?: string): string {
  return installationId
    ? `${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}/${encodeURIComponent(
        installationId,
      )}`
    : TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH;
}

function readAccountsExpectedGuard(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  const expected = readRecord(value?.expected);
  if (!expected) {
    throw new ServiceUnavailableError(
      "Installation plan Run response is missing expected guard",
    );
  }
  return expected;
}

function defaultAppMode(
  entry: DefaultAppDistributionEntry,
  requestedMode: string | undefined,
): string {
  if (requestedMode) return requestedMode;
  const firstMode = (entry.runtimeModes as readonly string[] | undefined)?.[0];
  return firstMode || "shared-cell";
}

function defaultAppOpenTofuSource(entry: DefaultAppDistributionEntry): {
  kind: "git";
  url: string;
  ref: string;
  modulePath?: string;
} {
  return {
    kind: "git",
    url: entry.repositoryUrl,
    ref: entry.ref,
    ...(entry.modulePath ? { modulePath: entry.modulePath } : {}),
  };
}

function hasDefaultAppVariables(entry: DefaultAppDistributionEntry): boolean {
  return Boolean(entry.variables && Object.keys(entry.variables).length > 0);
}

async function postAccountsInstallationJson(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsSessionCaller,
  path: string,
  body: Record<string, unknown>,
): Promise<InstallableAppUpstreamResponse> {
  return await accountsPlaneJson(c, path, {
    method: "POST",
    headers: jsonHeaders(caller.headers),
    body: JSON.stringify(body),
  });
}

async function applyDefaultAppInstallationForRoute(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsSessionCaller,
  entry: DefaultAppDistributionEntry,
  params: {
    spaceId: string;
    mode: string;
  },
): Promise<InstallableAppUpstreamResponse> {
  const source = defaultAppOpenTofuSource(entry);
  const planBody: Record<string, unknown> = {
    spaceId: params.spaceId,
    source,
  };
  if (hasDefaultAppVariables(entry)) planBody.variables = entry.variables;
  const plan = await postAccountsInstallationJson(
    c,
    caller,
    TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH,
    planBody,
  );
  if (plan.status >= 400) return plan;
  const expected = readAccountsExpectedGuard(plan.body);
  const applyBody: Record<string, unknown> = {
    accountId: params.spaceId,
    spaceId: params.spaceId,
    createdBySubject: caller.subject,
    source,
    expected,
    mode: params.mode,
  };
  if (entry.modulePath) applyBody.modulePath = entry.modulePath;
  if (hasDefaultAppVariables(entry)) applyBody.vars = entry.variables;
  return await postAccountsInstallationJson(
    c,
    caller,
    TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
    applyBody,
  );
}

async function listInstallableAppInstallationsForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsSessionCaller(c);
  if (caller) {
    return await accountsPlaneGetJson(
      c,
      TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
      caller.headers,
      { space_id: spaceId },
    );
  }
  return await appInstallationsRouteDeps.listInstallableAppInstallations(
    spaceId,
    appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
  );
}

async function listInstallableAppInstallationServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  installationId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsSessionCaller(c);
  if (caller) {
    // Deploy decision D3: the retired `/services` endpoint is replaced by the
    // installation deployment-output projection.
    const result = await accountsPlaneGetJson(
      c,
      accountsInstallationsPath(installationId),
      caller.headers,
    );
    if (result.status >= 400) return result;
    return {
      status: result.status,
      body: installationProjectionToServicesBody(installationId, result.body),
    };
  }
  return await appInstallationsRouteDeps.listInstallableAppInstallationServices(
    installationId,
    appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
  );
}

async function listInstallableAppInstallationsWithServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsSessionCaller(c);
  if (!caller) {
    return await appInstallationsRouteDeps.listInstallableAppInstallationsWithServices(
      spaceId,
      appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
    );
  }
  const upstream = await accountsPlaneGetJson(
    c,
    TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
    caller.headers,
    { space_id: spaceId },
  );
  if (upstream.status >= 400) return upstream;
  const installations = Array.isArray(upstream.body?.installations)
    ? upstream.body.installations
    : null;
  if (!installations) return upstream;
  const enriched = await Promise.all(
    installations.map(async (installation) => {
      const record = readRecord(installation);
      if (!record) return installation;
      const installationId =
        readString(record.id) ??
        readString(record.installation_id) ??
        readString(record.installationId);
      if (!installationId) return installation;
      const services = await accountsPlaneGetJson(
        c,
        accountsInstallationsPath(installationId),
        caller.headers,
      );
      if (services.status >= 400) {
        return installation;
      }
      return {
        ...record,
        services: projectWorkloadServicesFromInstallationBody(services.body),
      };
    }),
  );
  return {
    status: upstream.status,
    body: {
      ...upstream.body,
      installations: enriched,
    },
  };
}

function findDefaultAppEntry(
  entries: DefaultAppDistributionEntry[],
  appId: string,
): DefaultAppDistributionEntry | null {
  return (
    entries.find((entry) => entry.appId === appId || entry.name === appId) ??
    null
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listInstallationIds(body: Record<string, unknown> | null): string[] {
  const installations = body?.installations;
  if (!Array.isArray(installations)) return [];
  const ids: string[] = [];
  for (const item of installations) {
    const record = readRecord(item);
    if (!record) continue;
    const id =
      readString(record.id) ??
      readString(record.installation_id) ??
      readString(record.installationId);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Confirm the supplied installationId belongs to the authorized space before
 * proxying a revision/delete to upstream. Without this, a member of space A
 * could drive deployments/rollbacks/deletes against an Installation owned by
 * space B by supplying its installationId. Resolves the authorized space's
 * Installations and rejects unknown ids with 404.
 */
async function assertInstallationBelongsToSpace(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
  installationId: string,
): Promise<void> {
  const list = await listInstallableAppInstallationsForRoute(c, spaceId);
  if (!listInstallationIds(list.body).includes(installationId)) {
    throw new NotFoundError("Installable app");
  }
}

function readPathString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    const record = readRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return readString(current);
}

function readBodyExpectedCommit(body: InstallableAppApplyBody): string | null {
  return (
    readString(body.expected_commit) ??
    readPathString(body.expected, ["commit"])
  );
}

function readBodyExpectedPlanDigest(
  body: InstallableAppApplyBody,
): string | null {
  return (
    readString(body.expected_plan_digest) ??
    readPathString(body.expected, ["planDigest"])
  );
}

function readBodyExpectedGuard(
  body: InstallableAppApplyBody,
): Record<string, unknown> | null {
  return readRecord(body.expected);
}

function gitSourceBody(source: {
  gitUrl: string;
  ref: string;
  modulePath?: string;
}): Record<string, unknown> {
  return {
    kind: "git",
    url: source.gitUrl,
    ref: source.ref,
    ...(source.modulePath ? { modulePath: source.modulePath } : {}),
  };
}

function readBodyExpectedCurrentDeploymentId(body: InstallableAppApplyBody): {
  provided: boolean;
  value: string | null;
} {
  if ("expected_current_deployment_id" in body) {
    return readNullableString(
      body.expected_current_deployment_id,
      "expected_current_deployment_id",
    );
  }
  const expected = readRecord(body.expected);
  if (expected && "currentDeploymentId" in expected) {
    return readNullableString(
      expected.currentDeploymentId,
      "expected.currentDeploymentId",
    );
  }
  return { provided: false, value: null };
}

function readNullableString(
  value: unknown,
  field: string,
): { provided: true; value: string | null } {
  if (value === null) return { provided: true, value: null };
  const text = readString(value);
  if (text) return { provided: true, value: text };
  throw new BadRequestError(`${field} must be a string or null`);
}

function extractInstallationId(value: unknown): string | null {
  return (
    readPathString(value, ["accounts", "installationId"]) ??
    readPathString(value, ["accounts", "installation_id"]) ??
    readPathString(value, ["installation", "id"]) ??
    readPathString(value, ["installation", "installation_id"]) ??
    readPathString(value, ["installationId"]) ??
    readPathString(value, ["installation_id"])
  );
}

function extractInstallationStatus(value: unknown): string {
  return (
    readPathString(value, ["installation", "status"]) ??
    readPathString(value, ["accounts", "status"]) ??
    readPathString(value, ["status"]) ??
    "installing"
  );
}

function toInstallationRecord(
  entry: DefaultAppDistributionEntry,
  upstream: unknown,
  params: {
    mode: string | null;
    timestamp: string;
  },
): InstallationApiRecord {
  return {
    installed: true,
    installation_id: extractInstallationId(upstream),
    app_id: entry.appId ?? entry.name,
    status: extractInstallationStatus(upstream),
    runtime_mode: params.mode,
    installed_version: entry.refType === "tag" ? entry.ref : null,
    installed_commit: null,
    installed_at: params.timestamp,
    updated_at: params.timestamp,
    group_id: null,
    group_name: null,
    deployed_at: null,
  };
}

const appInstallationsRouter = new Hono<SpaceAccessRouteEnv>();

appInstallationsRouter.get(
  "/spaces/:spaceId/app-installations",
  spaceAccess({ roles: ["owner", "admin", "editor", "viewer"] }),
  async (c) => {
    const { space } = c.get("access");
    const upstream = await listInstallableAppInstallationsWithServicesForRoute(
      c,
      space.id,
    );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.get(
  "/spaces/:spaceId/app-installations/:installationId/services",
  spaceAccess({ roles: ["owner", "admin", "editor", "viewer"] }),
  async (c) => {
    const { space } = c.get("access");
    const installationId = readString(c.req.param("installationId"));
    if (!installationId) {
      throw new BadRequestError("installation_id is required");
    }
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const upstream = await listInstallableAppInstallationServicesForRoute(
      c,
      installationId,
    );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/git-url/plan",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const source = readBodyInstallSource(body);
    if (!source) {
      throw new BadRequestError("git_url and ref are required");
    }
    const variables = readOptionalBodyVariables(body);
    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const upstream = await postAccountsInstallationJson(
        c,
        caller,
        TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH,
        {
          workspaceId: space.id,
          spaceId: space.id,
          source: gitSourceBody(source),
          ...(variables ? { variables } : {}),
        },
      );
      return jsonFromUpstream(c, upstream);
    }
    const installConfig =
      appInstallationsRouteDeps.resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation plan Run is not configured",
      );
    }
    const upstream =
      await appInstallationsRouteDeps.planInstallableAppInstallation(
        {
          ...source,
          spaceId: space.id,
          ...(variables ? { variables } : {}),
        },
        installConfig,
      );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/git-url/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const source = readBodyInstallSource(body);
    if (!source) {
      throw new BadRequestError("git_url and ref are required");
    }

    const costAck = readOptionalBodyBoolean(body, "cost_ack");
    const expected = readBodyExpectedGuard(body);
    const expectedCommit = readBodyExpectedCommit(body) ?? undefined;
    const expectedPlanDigest = readBodyExpectedPlanDigest(body) ?? undefined;
    if (!expected && (!expectedCommit || !expectedPlanDigest)) {
      throw new BadRequestError(
        "expected guard is required after install plan Run approval",
      );
    }
    const variables = readOptionalBodyVariables(body);

    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const mode = readOptionalBodyMode(body) ?? "shared-cell";
      const runtimeBaseUrl = readOptionalBodyRuntimeBaseUrl(body);
      const upstream = await postAccountsInstallationJson(
        c,
        caller,
        TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
        {
          accountId: space.id,
          workspaceId: space.id,
          spaceId: space.id,
          createdBySubject: caller.subject,
          source: gitSourceBody(source),
          expected: expected ?? {
            commit: expectedCommit,
            planDigest: expectedPlanDigest,
          },
          mode,
          ...(variables ? { vars: variables } : {}),
          ...(runtimeBaseUrl ? { runtimeBaseUrl } : {}),
          ...(costAck === undefined ? {} : { costAck }),
        },
      );
      return jsonFromUpstream(c, upstream);
    }

    const installConfig =
      appInstallationsRouteDeps.resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation apply is not configured",
      );
    }
    if (!installConfig.subject) {
      throw new ServiceUnavailableError(
        "Third-party Installation subject is not configured",
      );
    }
    const mode = readOptionalBodyMode(body) ?? installConfig.mode;
    const runtimeBaseUrl =
      readOptionalBodyRuntimeBaseUrl(body) ?? installConfig.runtimeBaseUrl;

    const upstream =
      await appInstallationsRouteDeps.applyInstallableAppInstallation(
        {
          ...source,
          accountId: installConfig.accountId ?? space.id,
          spaceId: space.id,
          subject: installConfig.subject,
          ...(mode ? { mode } : {}),
          ...(runtimeBaseUrl ? { runtimeBaseUrl } : {}),
          ...(expected ? { expected } : {}),
          ...(expectedCommit ? { expectedCommit } : {}),
          ...(expectedPlanDigest ? { expectedPlanDigest } : {}),
          ...(variables ? { variables } : {}),
          ...(costAck === undefined ? {} : { costAck }),
        },
        installConfig,
      );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/git-url/revision/plan",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const source = readBodyInstallSource(body);
    if (!source) {
      throw new BadRequestError("git_url and ref are required");
    }
    const installationId = readRequiredInstallationId(body);
    const operation = readBodyRevisionOperation(body);
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const sourceCommit = readString(body.source_commit) ?? undefined;
    const reason = readString(body.reason) ?? undefined;
    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const upstream = await postAccountsInstallationJson(
        c,
        caller,
        `${accountsInstallationsPath(installationId)}/deployments/plan-runs`,
        {
          source: {
            ...gitSourceBody(source),
            ...(sourceCommit ? { commit: sourceCommit } : {}),
          },
          ...(reason ? { reason } : {}),
        },
      );
      return jsonFromUpstream(c, upstream);
    }
    const installConfig =
      appInstallationsRouteDeps.resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation deployment plan Run is not configured",
      );
    }
    const upstream = await appInstallationsRouteDeps.planInstallableAppRevision(
      {
        ...source,
        installationId,
        operation,
        ...(sourceCommit ? { sourceCommit } : {}),
        ...(reason ? { reason } : {}),
      },
      installConfig,
    );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/git-url/revision/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const source = readBodyInstallSource(body);
    if (!source) {
      throw new BadRequestError("git_url and ref are required");
    }
    const installationId = readRequiredInstallationId(body);
    const operation = readBodyRevisionOperation(body);
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const sourceCommit = readString(body.source_commit) ?? undefined;
    const reason = readString(body.reason) ?? undefined;
    const expectedCommit = readBodyExpectedCommit(body) ?? undefined;
    const expectedPlanDigest = readBodyExpectedPlanDigest(body) ?? undefined;
    const expectedCurrentDeploymentId =
      readBodyExpectedCurrentDeploymentId(body);
    if (
      operation === "upgrade" &&
      (!expectedCommit ||
        !expectedPlanDigest ||
        !expectedCurrentDeploymentId.provided)
    ) {
      throw new BadRequestError(
        "expected.commit, expected.planDigest, and expected.currentDeploymentId are required after deployment plan Run approval",
      );
    }
    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const path =
        operation === "rollback"
          ? `${accountsInstallationsPath(installationId)}/rollback`
          : `${accountsInstallationsPath(installationId)}/deployments`;
      const upstream = await postAccountsInstallationJson(c, caller, path, {
        ...(operation === "rollback"
          ? { deploymentId: source.ref }
          : {
              source: {
                ...gitSourceBody(source),
                ...(sourceCommit ? { commit: sourceCommit } : {}),
              },
              ...(expectedCommit &&
              expectedPlanDigest &&
              expectedCurrentDeploymentId.provided
                ? {
                    expected: {
                      commit: expectedCommit,
                      planDigest: expectedPlanDigest,
                      currentDeploymentId: expectedCurrentDeploymentId.value,
                    },
                  }
                : {}),
            }),
        ...(reason ? { reason } : {}),
      });
      return jsonFromUpstream(c, upstream);
    }
    const installConfig =
      appInstallationsRouteDeps.resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation deployment apply is not configured",
      );
    }
    const upstream =
      await appInstallationsRouteDeps.applyInstallableAppRevision(
        {
          ...source,
          installationId,
          operation,
          ...(sourceCommit ? { sourceCommit } : {}),
          ...(reason ? { reason } : {}),
          ...(expectedCommit ? { expectedCommit } : {}),
          ...(expectedPlanDigest ? { expectedPlanDigest } : {}),
          ...(expectedCurrentDeploymentId.provided
            ? { expectedCurrentDeploymentId: expectedCurrentDeploymentId.value }
            : {}),
        },
        installConfig,
      );
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }

    const appId = readBodyAppId(body);
    const entries =
      await appInstallationsRouteDeps.resolveDefaultAppDistributionForBootstrap(
        c.env,
      );
    const entry = findDefaultAppEntry(entries, appId);
    if (!entry?.appId) {
      throw new NotFoundError("Installable app");
    }

    const mode = readBodyMode(body, entry);
    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const selectedMode = defaultAppMode(entry, mode);
      const upstream = await applyDefaultAppInstallationForRoute(
        c,
        caller,
        entry,
        {
          spaceId: space.id,
          mode: selectedMode,
        },
      );
      if (upstream.status >= 400) return jsonFromUpstream(c, upstream);
      const timestamp = new Date().toISOString();
      return c.json(
        {
          installation: toInstallationRecord(entry, upstream.body, {
            mode: selectedMode,
            timestamp,
          }),
          subject_source: "accounts_session",
        },
        202,
      );
    }

    const installConfig =
      appInstallationsRouteDeps.resolveDefaultAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Installation install is not configured",
      );
    }

    const upstream =
      await appInstallationsRouteDeps.applyDefaultAppInstallation(
        entry,
        installConfig,
        {
          spaceId: space.id,
          createdByAccountId: space.id,
          ...(mode ? { mode } : {}),
        },
      );
    const timestamp = new Date().toISOString();

    return c.json(
      {
        installation: toInstallationRecord(entry, upstream, {
          mode: mode ?? installConfig.mode ?? null,
          timestamp,
        }),
        subject_source: "operator_config",
      },
      202,
    );
  },
);

appInstallationsRouter.delete(
  "/spaces/:spaceId/app-installations/:installationId",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const installationId = readString(c.req.param("installationId"));
    if (!installationId) {
      throw new BadRequestError("installation_id is required");
    }
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    const reason =
      body === null ? undefined : (readString(body.reason) ?? undefined);
    const caller = await resolveAccountsSessionCaller(c);
    if (caller) {
      const upstream = await accountsPlaneJson(
        c,
        accountsInstallationsPath(installationId),
        {
          method: "DELETE",
          headers: reason
            ? jsonHeaders(caller.headers)
            : new Headers(caller.headers),
          ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        },
      );
      return jsonFromUpstream(c, upstream);
    }
    const upstream =
      await appInstallationsRouteDeps.deleteInstallableAppInstallation(
        installationId,
        appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
        reason,
      );
    return jsonFromUpstream(c, upstream);
  },
);

export default appInstallationsRouter;
