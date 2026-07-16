import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  BadRequestError,
  AuthenticationError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import {
  applyFeaturedAppInstallation,
  type FeaturedAppCatalogEntry,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
} from "../../application/services/source/featured-app-catalog.ts";
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
  parseJsonBody,
  spaceAccess,
  type SpaceAccessRouteEnv,
} from "./route-auth.ts";
import { accountsDelegatedAuthorization } from "./auth/accounts-delegation.ts";
import { takosumiSessionApiUrl } from "../../application/services/takosumi-control-paths.ts";

type InstallableAppApplyBody = {
  app_id?: unknown;
  git_url?: unknown;
  ref?: unknown;
  path?: unknown;
  module_path?: unknown;
  modulePath?: unknown;
  mode?: unknown;
  state_version_id?: unknown;
  expected?: unknown;
  variables?: unknown;
  vars?: unknown;
  installation_id?: unknown;
  operation?: unknown;
  reason?: unknown;
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
  applyFeaturedAppInstallation,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
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
  accountsDelegatedAuthorization,
  accountsPlaneFetch: (request: Request) => fetch(request),
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
  entry: FeaturedAppCatalogEntry,
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

function readOptionalBodyVariables(
  body: InstallableAppApplyBody,
): Record<string, unknown> | undefined {
  return readRecord(body.variables) ?? readRecord(body.vars) ?? undefined;
}

function jsonFromUpstream(
  c: Context<SpaceAccessRouteEnv>,
  result: InstallableAppUpstreamResponse,
): Response {
  return c.json(result.body, result.status as ContentfulStatusCode);
}

const TAKOSUMI_ACCOUNTS_SESSION_ME_PATH = "/v1/account/session/me";
const TAKOSUMI_ACCOUNTS_SESSION_COOKIE_NAME = "takosumi_session";

type AccountsCaller = {
  kind: "accounts_session" | "oauth_access_token";
  subject?: string;
  workspaceId?: string;
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
  const config = appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(
    c.env,
  );
  if (!config) {
    return {
      status: 503,
      body: { error: "Takosumi Accounts API is not configured" },
    };
  }
  const url = takosumiSessionApiUrl(config.baseUrl, path);
  const request = new Request(url.toString(), init);
  const response = await appInstallationsRouteDeps.accountsPlaneFetch(request);
  return {
    status: response.status,
    body: await readUpstreamBody(response),
  };
}

async function resolveAccountsCaller(
  c: Context<SpaceAccessRouteEnv>,
): Promise<AccountsCaller | null> {
  const user = c.get("user");
  const issuer = readString(c.env.OIDC_ISSUER_URL);
  const clientId = readString(c.env.OIDC_CLIENT_ID);
  const encryptionKey = readString(c.env.ENCRYPTION_KEY);
  if (user && issuer && clientId && encryptionKey && c.env.DB) {
    const authorization =
      await appInstallationsRouteDeps.accountsDelegatedAuthorization({
        db: c.env.DB,
        encryptionKey,
        userId: user.id,
        issuer: issuer.replace(/\/+$/u, ""),
        clientId,
        access: c.req.method === "GET" ? "read" : "write",
      });
    return {
      kind: "oauth_access_token",
      workspaceId: authorization.workspaceId,
      headers: new Headers({
        accept: "application/json",
        authorization: `Bearer ${authorization.accessToken}`,
      }),
    };
  }

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

function accountsCallerWorkspaceId(
  caller: AccountsCaller,
  _localWorkspaceId: string,
): string {
  if (!caller.workspaceId) {
    throw new AuthenticationError(
      "Takosumi Workspace-bound OAuth authorization is required",
    );
  }
  return caller.workspaceId;
}

function readCanonicalPlanReference(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  const expected = readRecord(value?.expected);
  if (!expected) {
    throw new ServiceUnavailableError(
      "Capsule plan response is missing its exact Run reference",
    );
  }
  return expected;
}

function featuredAppMode(
  entry: FeaturedAppCatalogEntry,
  requestedMode: string | undefined,
): string {
  if (requestedMode) return requestedMode;
  const firstMode = (entry.runtimeModes as readonly string[] | undefined)?.[0];
  return firstMode || "shared-cell";
}

function hasFeaturedAppVariables(entry: FeaturedAppCatalogEntry): boolean {
  return Boolean(entry.variables && Object.keys(entry.variables).length > 0);
}

function callerAccountsConfig(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
): ReturnType<typeof resolveInstallableAppAccountsConfig> {
  const config = appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(
    c.env,
  );
  if (!config) return null;
  return {
    baseUrl: config.baseUrl,
    headers: caller.headers,
    fetch: (input, init) =>
      appInstallationsRouteDeps.accountsPlaneFetch(
        input instanceof Request ? input : new Request(input, init),
      ),
  };
}

function operatorRouteConfig(c: Context<SpaceAccessRouteEnv>): {
  workspaceId: string;
  installConfig: NonNullable<
    ReturnType<typeof resolveInstallableAppInstallConfig>
  >;
  accountsConfig: NonNullable<
    ReturnType<typeof resolveInstallableAppAccountsConfig>
  >;
} {
  const installConfig =
    appInstallationsRouteDeps.resolveInstallableAppInstallConfig(c.env);
  const workspaceId = installConfig?.accountId;
  const controlUrl = installConfig?.controlUrl;
  const token = installConfig?.token;
  if (!installConfig || !workspaceId || !controlUrl || !token) {
    throw new ServiceUnavailableError(
      "Operator Capsule automation requires canonical control URL, token, and Takosumi Workspace id",
    );
  }
  return {
    workspaceId,
    installConfig,
    accountsConfig: {
      baseUrl: controlUrl,
      token,
      fetch: (input, init) =>
        appInstallationsRouteDeps.accountsPlaneFetch(
          input instanceof Request ? input : new Request(input, init),
        ),
    },
  };
}

function callerInstallConfig(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
): ReturnType<typeof resolveInstallableAppInstallConfig> {
  const accounts = callerAccountsConfig(c, caller);
  if (!accounts) return null;
  return {
    controlUrl: accounts.baseUrl,
    headers: caller.headers,
    fetch: accounts.fetch,
  };
}

async function applyFeaturedAppInstallationForRoute(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
  entry: FeaturedAppCatalogEntry,
  params: {
    localWorkspaceId: string;
    mode: string;
  },
): Promise<InstallableAppUpstreamResponse> {
  const workspaceId = accountsCallerWorkspaceId(
    caller,
    params.localWorkspaceId,
  );
  const config = callerInstallConfig(c, caller);
  if (!config) {
    throw new ServiceUnavailableError(
      "Takosumi canonical Capsule API is not configured",
    );
  }
  const plan = await appInstallationsRouteDeps.planInstallableAppInstallation(
    {
      workspaceId,
      appId: entry.appId ?? entry.name,
      gitUrl: entry.repositoryUrl,
      ref: entry.ref,
      ...(entry.modulePath ? { modulePath: entry.modulePath } : {}),
      ...(hasFeaturedAppVariables(entry) ? { variables: entry.variables } : {}),
    },
    config,
  );
  if (plan.status >= 400) return plan;
  const expected = readCanonicalPlanReference(plan.body);
  return await appInstallationsRouteDeps.applyInstallableAppInstallation(
    {
      workspaceId,
      gitUrl: entry.repositoryUrl,
      ref: entry.ref,
      ...(entry.modulePath ? { modulePath: entry.modulePath } : {}),
      expected,
    },
    config,
  );
}

async function listInstallableAppInstallationsForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (caller) {
    return await appInstallationsRouteDeps.listInstallableAppInstallations(
      accountsCallerWorkspaceId(caller, spaceId),
      callerAccountsConfig(c, caller),
    );
  }
  const operator = operatorRouteConfig(c);
  return await appInstallationsRouteDeps.listInstallableAppInstallations(
    operator.workspaceId,
    operator.accountsConfig,
  );
}

async function listInstallableAppInstallationServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
  installationId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (caller) {
    return await appInstallationsRouteDeps.listInstallableAppInstallationServices(
      installationId,
      accountsCallerWorkspaceId(caller, spaceId),
      callerAccountsConfig(c, caller),
    );
  }
  const operator = operatorRouteConfig(c);
  return await appInstallationsRouteDeps.listInstallableAppInstallationServices(
    installationId,
    operator.workspaceId,
    operator.accountsConfig,
  );
}

async function listInstallableAppInstallationsWithServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (!caller) {
    const operator = operatorRouteConfig(c);
    return await appInstallationsRouteDeps.listInstallableAppInstallationsWithServices(
      operator.workspaceId,
      operator.accountsConfig,
    );
  }
  return await appInstallationsRouteDeps.listInstallableAppInstallationsWithServices(
    accountsCallerWorkspaceId(caller, spaceId),
    callerAccountsConfig(c, caller),
  );
}

function findFeaturedAppEntry(
  entries: FeaturedAppCatalogEntry[],
  appId: string,
): FeaturedAppCatalogEntry | null {
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
 * Confirm the supplied local UI id resolves to a Capsule in the authorized
 * Workspace before proxying a revision/delete. The canonical API repeats this
 * check server-side; this early 404 also avoids cross-Workspace id probing.
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

function readBodyExpectedGuard(
  body: InstallableAppApplyBody,
): Record<string, unknown> | null {
  return readRecord(body.expected);
}

function extractInstallationId(value: unknown): string | null {
  return (
    readPathString(value, ["capsule", "id"]) ??
    readPathString(value, ["accounts", "installationId"]) ??
    readPathString(value, ["accounts", "installation_id"]) ??
    readPathString(value, ["installation", "id"]) ??
    readPathString(value, ["installation", "installation_id"]) ??
    readPathString(value, ["installationId"]) ??
    readPathString(value, ["installation_id"])
  );
}

function extractInstallationStatus(value: unknown): string {
  const status =
    readPathString(value, ["capsule", "status"]) ??
    readPathString(value, ["installation", "status"]) ??
    readPathString(value, ["accounts", "status"]) ??
    readPathString(value, ["status"]) ??
    "installing";
  return status === "active" ? "ready" : status;
}

function toInstallationRecord(
  entry: FeaturedAppCatalogEntry,
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
      space.id,
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
    const caller = await resolveAccountsCaller(c);
    const operator = caller ? null : operatorRouteConfig(c);
    const installConfig = caller
      ? callerInstallConfig(c, caller)
      : operator?.installConfig;
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Capsule plan Run is not configured",
      );
    }
    const workspaceId = caller
      ? accountsCallerWorkspaceId(caller, space.id)
      : operator!.workspaceId;
    const upstream =
      await appInstallationsRouteDeps.planInstallableAppInstallation(
        {
          ...source,
          workspaceId,
          ...(readOptionalBodyAppId(body)
            ? { appId: readOptionalBodyAppId(body)! }
            : {}),
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
    const expected = readBodyExpectedGuard(body);
    if (!expected) {
      throw new BadRequestError(
        "expected exact Run reference is required after Capsule plan",
      );
    }

    const caller = await resolveAccountsCaller(c);
    const operator = caller ? null : operatorRouteConfig(c);
    const installConfig = caller
      ? callerInstallConfig(c, caller)
      : operator?.installConfig;
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Capsule apply is not configured",
      );
    }
    const workspaceId = caller
      ? accountsCallerWorkspaceId(caller, space.id)
      : operator!.workspaceId;

    const upstream =
      await appInstallationsRouteDeps.applyInstallableAppInstallation(
        {
          workspaceId,
          expected,
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
    const installationId = readRequiredInstallationId(body);
    const operation = readBodyRevisionOperation(body);
    const source = operation === "upgrade" ? readBodyInstallSource(body) : null;
    if (operation === "upgrade" && !source) {
      throw new BadRequestError("git_url and ref are required for upgrade");
    }
    const revisionRef =
      operation === "rollback"
        ? (readString(body.state_version_id) ?? readString(body.ref))
        : source?.ref;
    if (!revisionRef) {
      throw new BadRequestError("state_version_id is required for rollback");
    }
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const reason = readString(body.reason) ?? undefined;
    const caller = await resolveAccountsCaller(c);
    const operator = caller ? null : operatorRouteConfig(c);
    const installConfig = caller
      ? callerInstallConfig(c, caller)
      : operator?.installConfig;
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Capsule revision plan Run is not configured",
      );
    }
    const workspaceId = caller
      ? accountsCallerWorkspaceId(caller, space.id)
      : operator!.workspaceId;
    const upstream = await appInstallationsRouteDeps.planInstallableAppRevision(
      {
        workspaceId,
        capsuleId: installationId,
        operation,
        ref: revisionRef,
        ...(source?.gitUrl ? { gitUrl: source.gitUrl } : {}),
        ...(source?.modulePath ? { modulePath: source.modulePath } : {}),
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
    const installationId = readRequiredInstallationId(body);
    const operation = readBodyRevisionOperation(body);
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const expected = readBodyExpectedGuard(body);
    if (!expected) {
      throw new BadRequestError(
        "expected exact Run reference is required after Capsule revision plan",
      );
    }
    const caller = await resolveAccountsCaller(c);
    const operator = caller ? null : operatorRouteConfig(c);
    const installConfig = caller
      ? callerInstallConfig(c, caller)
      : operator?.installConfig;
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Capsule revision apply is not configured",
      );
    }
    const workspaceId = caller
      ? accountsCallerWorkspaceId(caller, space.id)
      : operator!.workspaceId;
    const upstream =
      await appInstallationsRouteDeps.applyInstallableAppRevision(
        {
          workspaceId,
          capsuleId: installationId,
          operation,
          expected,
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
      await appInstallationsRouteDeps.resolveFeaturedAppCatalogForBootstrap(
        c.env,
      );
    const entry = findFeaturedAppEntry(entries, appId);
    if (!entry?.appId) {
      throw new NotFoundError("Installable app");
    }

    const mode = readBodyMode(body, entry);
    const caller = await resolveAccountsCaller(c);
    if (caller) {
      const selectedMode = featuredAppMode(entry, mode);
      const upstream = await applyFeaturedAppInstallationForRoute(
        c,
        caller,
        entry,
        {
          localWorkspaceId: space.id,
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
      appInstallationsRouteDeps.resolveFeaturedAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError("Capsule install is not configured");
    }

    const upstream =
      await appInstallationsRouteDeps.applyFeaturedAppInstallation(
        entry,
        installConfig,
        {
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
    const caller = await resolveAccountsCaller(c);
    const operator = caller ? null : operatorRouteConfig(c);
    const workspaceId = caller
      ? accountsCallerWorkspaceId(caller, space.id)
      : operator!.workspaceId;
    const accountsConfig = caller
      ? callerAccountsConfig(c, caller)
      : operator!.accountsConfig;
    const upstream =
      await appInstallationsRouteDeps.deleteInstallableAppInstallation(
        installationId,
        workspaceId,
        accountsConfig,
        reason,
      );
    return jsonFromUpstream(c, upstream);
  },
);

export default appInstallationsRouter;
