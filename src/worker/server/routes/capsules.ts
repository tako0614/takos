import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  BadRequestError,
  AuthenticationError,
  AuthorizationError,
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
  applyInstallableAppCapsule,
  applyInstallableAppRevision,
  deleteInstallableAppCapsule,
  planInstallableAppCapsule,
  planInstallableAppRevision,
  type InstallableAppRevisionOperation,
  type InstallableAppUpstreamResponse,
  listInstallableAppCapsuleServices,
  listInstallableAppCapsules,
  listInstallableAppCapsulesWithServices,
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
  capsule_id?: unknown;
  operation?: unknown;
  reason?: unknown;
};

type CapsuleApiRecord = {
  capsule_id: string | null;
  app_id: string;
  status: string;
  source_ref: string | null;
  source_commit: string | null;
  created_at: string;
  updated_at: string;
};

export const capsulesRouteDeps = {
  applyFeaturedAppInstallation,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
  resolveInstallableAppAccountsConfig,
  resolveInstallableAppInstallConfig,
  listInstallableAppCapsules,
  deleteInstallableAppCapsule,
  planInstallableAppCapsule,
  applyInstallableAppCapsule,
  planInstallableAppRevision,
  applyInstallableAppRevision,
  listInstallableAppCapsulesWithServices,
  listInstallableAppCapsuleServices,
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

function readRequiredCapsuleId(body: InstallableAppApplyBody): string {
  const capsuleId = readString(body.capsule_id);
  if (!capsuleId) {
    throw new BadRequestError("capsule_id is required");
  }
  return capsuleId;
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
  subjectId?: string;
  accessToken?: string;
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
  const config = capsulesRouteDeps.resolveInstallableAppAccountsConfig(
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
  const response = await capsulesRouteDeps.accountsPlaneFetch(request);
  return {
    status: response.status,
    body: await readUpstreamBody(response),
  };
}

async function resolveAccountsCaller(
  c: Context<SpaceAccessRouteEnv>,
): Promise<AccountsCaller | null> {
  const accountsBearer = c.get("accounts_bearer");
  if (accountsBearer) {
    return {
      kind: "oauth_access_token",
      accessToken: accountsBearer.accessToken,
      subjectId: accountsBearer.subjectId,
      workspaceId: accountsBearer.workspaceId,
      headers: new Headers({
        accept: "application/json",
        authorization: `Bearer ${accountsBearer.accessToken}`,
      }),
    };
  }
  const user = c.get("user");
  const issuer = readString(c.env.OIDC_ISSUER_URL);
  const clientId = readString(c.env.OIDC_CLIENT_ID);
  const encryptionKey = readString(c.env.ENCRYPTION_KEY);
  if (user && issuer && clientId && encryptionKey && c.env.DB) {
    const authorization =
      await capsulesRouteDeps.accountsDelegatedAuthorization({
        db: c.env.DB,
        encryptionKey,
        userId: user.id,
        issuer: issuer.replace(/\/+$/u, ""),
        clientId,
        access: c.req.method === "GET" ? "read" : "write",
      });
    return {
      kind: "oauth_access_token",
      accessToken: authorization.accessToken,
      subjectId: authorization.subjectId,
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
    subjectId: subject,
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

function hasFeaturedAppVariables(entry: FeaturedAppCatalogEntry): boolean {
  return Boolean(entry.variables && Object.keys(entry.variables).length > 0);
}

function callerAccountsConfig(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
): ReturnType<typeof resolveInstallableAppAccountsConfig> {
  const config = capsulesRouteDeps.resolveInstallableAppAccountsConfig(
    c.env,
  );
  if (!config) return null;
  return {
    baseUrl: config.baseUrl,
    ...(caller.accessToken ? { token: caller.accessToken } : {}),
    ...(caller.subjectId ? { subjectId: caller.subjectId } : {}),
    headers: caller.headers,
    fetch: (input, init) =>
      capsulesRouteDeps.accountsPlaneFetch(
        input instanceof Request ? input : new Request(input, init),
      ),
  };
}

/**
 * Operator automation is one static token bound to one Takosumi Workspace for
 * the whole deployment, so it carries no per-space authority: without this gate
 * an editor in *any* local space drives the Capsules of every other space, and
 * `assertCapsuleBelongsToSpace()` cannot catch it because it lists that
 * same shared Workspace. The deployment therefore has to name the one space the
 * automation Workspace belongs to (`TAKOS_APP_INSTALL_SPACE_ID`, id or slug);
 * an unset binding fails closed rather than defaulting to "every space".
 */
function assertOperatorSpaceBinding(c: Context<SpaceAccessRouteEnv>): void {
  const { space } = c.get("access");
  const boundSpace = readString(c.env.TAKOS_APP_INSTALL_SPACE_ID);
  if (!boundSpace || (boundSpace !== space.id && boundSpace !== space.slug)) {
    throw new AuthorizationError(
      "Operator Capsule automation is not bound to this space; set TAKOS_APP_INSTALL_SPACE_ID to the space that owns the operator Takosumi Workspace",
    );
  }
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
  assertOperatorSpaceBinding(c);
  const installConfig =
    capsulesRouteDeps.resolveInstallableAppInstallConfig(c.env);
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
        capsulesRouteDeps.accountsPlaneFetch(
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

async function applyFeaturedAppCapsuleForRoute(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
  entry: FeaturedAppCatalogEntry,
  params: { localWorkspaceId: string },
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
  const plan = await capsulesRouteDeps.planInstallableAppCapsule(
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
  return await capsulesRouteDeps.applyInstallableAppCapsule(
    {
      workspaceId,
      expected,
    },
    config,
  );
}

async function listInstallableAppCapsulesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (caller) {
    return await capsulesRouteDeps.listInstallableAppCapsules(
      accountsCallerWorkspaceId(caller, spaceId),
      callerAccountsConfig(c, caller),
    );
  }
  const operator = operatorRouteConfig(c);
  return await capsulesRouteDeps.listInstallableAppCapsules(
    operator.workspaceId,
    operator.accountsConfig,
  );
}

async function listInstallableAppCapsuleServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
  capsuleId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (caller) {
    return await capsulesRouteDeps.listInstallableAppCapsuleServices(
      capsuleId,
      accountsCallerWorkspaceId(caller, spaceId),
      callerAccountsConfig(c, caller),
    );
  }
  const operator = operatorRouteConfig(c);
  return await capsulesRouteDeps.listInstallableAppCapsuleServices(
    capsuleId,
    operator.workspaceId,
    operator.accountsConfig,
  );
}

async function listInstallableAppCapsulesWithServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await resolveAccountsCaller(c);
  if (!caller) {
    const operator = operatorRouteConfig(c);
    return await capsulesRouteDeps.listInstallableAppCapsulesWithServices(
      operator.workspaceId,
      operator.accountsConfig,
    );
  }
  return await capsulesRouteDeps.listInstallableAppCapsulesWithServices(
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

function listCapsuleIds(body: Record<string, unknown> | null): string[] {
  const capsules = body?.capsules;
  if (!Array.isArray(capsules)) return [];
  const ids: string[] = [];
  for (const item of capsules) {
    const record = readRecord(item);
    if (!record) continue;
    const id = readString(record.capsule_id);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Confirm the supplied local UI id resolves to a Capsule in the authorized
 * Workspace before proxying a revision/delete. The canonical API repeats this
 * check server-side; this early 404 also avoids cross-Workspace id probing.
 */
async function assertCapsuleBelongsToSpace(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
  capsuleId: string,
): Promise<void> {
  const list = await listInstallableAppCapsulesForRoute(c, spaceId);
  if (!listCapsuleIds(list.body).includes(capsuleId)) {
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

function extractCapsuleId(value: unknown): string | null {
  return (
    readPathString(value, ["capsule", "id"]) ??
    readPathString(value, ["capsuleId"]) ??
    readPathString(value, ["capsule_id"])
  );
}

function extractCapsuleStatus(value: unknown): string {
  const status =
    readPathString(value, ["capsule", "status"]) ??
    readPathString(value, ["status"]) ??
    "installing";
  return status;
}

function toCapsuleRecord(
  entry: FeaturedAppCatalogEntry,
  upstream: unknown,
  params: { timestamp: string },
): CapsuleApiRecord {
  return {
    capsule_id: extractCapsuleId(upstream),
    app_id: entry.appId ?? entry.name,
    status: extractCapsuleStatus(upstream),
    source_ref: entry.ref,
    source_commit: null,
    created_at: params.timestamp,
    updated_at: params.timestamp,
  };
}

const capsulesRouter = new Hono<SpaceAccessRouteEnv>();

capsulesRouter.get(
  "/spaces/:spaceId/capsules",
  spaceAccess({ roles: ["owner", "admin", "editor", "viewer"] }),
  async (c) => {
    const { space } = c.get("access");
    const upstream = await listInstallableAppCapsulesWithServicesForRoute(
      c,
      space.id,
    );
    return jsonFromUpstream(c, upstream);
  },
);

capsulesRouter.get(
  "/spaces/:spaceId/capsules/:capsuleId/services",
  spaceAccess({ roles: ["owner", "admin", "editor", "viewer"] }),
  async (c) => {
    const { space } = c.get("access");
    const capsuleId = readString(c.req.param("capsuleId"));
    if (!capsuleId) {
      throw new BadRequestError("capsule_id is required");
    }
    await assertCapsuleBelongsToSpace(c, space.id, capsuleId);
    const upstream = await listInstallableAppCapsuleServicesForRoute(
      c,
      space.id,
      capsuleId,
    );
    return jsonFromUpstream(c, upstream);
  },
);

capsulesRouter.post(
  "/spaces/:spaceId/capsules/git-url/plan",
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
      await capsulesRouteDeps.planInstallableAppCapsule(
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

capsulesRouter.post(
  "/spaces/:spaceId/capsules/git-url/apply",
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
      await capsulesRouteDeps.applyInstallableAppCapsule(
        {
          workspaceId,
          expected,
        },
        installConfig,
      );
    return jsonFromUpstream(c, upstream);
  },
);

capsulesRouter.post(
  "/spaces/:spaceId/capsules/git-url/revision/plan",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const capsuleId = readRequiredCapsuleId(body);
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
    await assertCapsuleBelongsToSpace(c, space.id, capsuleId);
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
    const upstream = await capsulesRouteDeps.planInstallableAppRevision(
      {
        workspaceId,
        capsuleId,
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

capsulesRouter.post(
  "/spaces/:spaceId/capsules/git-url/revision/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }
    const capsuleId = readRequiredCapsuleId(body);
    const operation = readBodyRevisionOperation(body);
    await assertCapsuleBelongsToSpace(c, space.id, capsuleId);
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
      await capsulesRouteDeps.applyInstallableAppRevision(
        {
          workspaceId,
          capsuleId,
          operation,
          expected,
        },
        installConfig,
      );
    return jsonFromUpstream(c, upstream);
  },
);

capsulesRouter.post(
  "/spaces/:spaceId/capsules/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }

    const appId = readBodyAppId(body);
    const entries =
      await capsulesRouteDeps.resolveFeaturedAppCatalogForBootstrap(
        c.env,
      );
    const entry = findFeaturedAppEntry(entries, appId);
    if (!entry?.appId) {
      throw new NotFoundError("Installable app");
    }

    const mode = readBodyMode(body, entry);
    const caller = await resolveAccountsCaller(c);
    if (caller) {
      const upstream = await applyFeaturedAppCapsuleForRoute(
        c,
        caller,
        entry,
        {
          localWorkspaceId: space.id,
        },
      );
      if (upstream.status >= 400) return jsonFromUpstream(c, upstream);
      const timestamp = new Date().toISOString();
      return c.json(
        {
          capsule: toCapsuleRecord(entry, upstream.body, {
            timestamp,
          }),
          subject_source: "accounts_session",
        },
        202,
      );
    }

    assertOperatorSpaceBinding(c);
    const installConfig =
      capsulesRouteDeps.resolveFeaturedAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError("Capsule install is not configured");
    }

    const upstream =
      await capsulesRouteDeps.applyFeaturedAppInstallation(
        entry,
        installConfig,
        {
          ...(mode ? { mode } : {}),
        },
      );
    const timestamp = new Date().toISOString();

    return c.json(
      {
        capsule: toCapsuleRecord(entry, upstream, {
          timestamp,
        }),
        subject_source: "operator_config",
      },
      202,
    );
  },
);

capsulesRouter.delete(
  "/spaces/:spaceId/capsules/:capsuleId",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const { space } = c.get("access");
    const capsuleId = readString(c.req.param("capsuleId"));
    if (!capsuleId) {
      throw new BadRequestError("capsule_id is required");
    }
    await assertCapsuleBelongsToSpace(c, space.id, capsuleId);
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
      await capsulesRouteDeps.deleteInstallableAppCapsule(
        capsuleId,
        workspaceId,
        accountsConfig,
        reason,
      );
    return jsonFromUpstream(c, upstream);
  },
);

export default capsulesRouter;
