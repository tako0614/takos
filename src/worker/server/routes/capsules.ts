import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  BadRequestError,
  AuthenticationError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

import {
  type FeaturedAppCatalogEntry,
  resolveFeaturedAppCatalogForBootstrap,
} from "../../application/services/source/featured-app-catalog.ts";
import {
  approveAndApplyInstallableAppCapsule,
  approveAndApplyInstallableAppRevision,
  deleteInstallableAppCapsule,
  planInstallableAppCapsule,
  planInstallableAppRevision,
  TAKOSUMI_GIT_LIFECYCLE_IDEMPOTENCY_KEY_MAX_BYTES,
  type InstallableAppRevisionOperation,
  type InstallableAppUpstreamResponse,
  type InstallableAppInstallConfig,
  listInstallableAppCapsuleServices,
  listInstallableAppCapsules,
  listInstallableAppCapsulesWithServices,
  resolveInstallableAppAccountsConfig,
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
  resolveFeaturedAppCatalogForBootstrap,
  resolveInstallableAppAccountsConfig,
  listInstallableAppCapsules,
  deleteInstallableAppCapsule,
  planInstallableAppCapsule,
  approveAndApplyInstallableAppCapsule,
  planInstallableAppRevision,
  approveAndApplyInstallableAppRevision,
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

const TAKOSUMI_ACCOUNTS_SESSION_ME_PATH = "/api/v1/account/session/me";
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

function accountsSessionCookie(cookie: string | undefined): string | null {
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== TAKOSUMI_ACCOUNTS_SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value
      ? `${TAKOSUMI_ACCOUNTS_SESSION_COOKIE_NAME}=${value}`
      : null;
  }
  return null;
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
  const cookie = accountsSessionCookie(c.req.header("Cookie"));
  if (cookie) {
    headers.set("cookie", cookie);
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

function callerInstallConfig(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
): InstallableAppInstallConfig | null {
  const accounts = callerAccountsConfig(c, caller);
  if (!accounts) return null;
  return {
    controlUrl: accounts.baseUrl,
    headers: caller.headers,
    fetch: accounts.fetch,
  };
}

/**
 * Capsule HTTP is an interactive user surface. A deployment-wide operator
 * token is deliberately not an alternative here: it has no per-request
 * Workspace authority and would let any editor drive another Workspace's
 * Capsule. Static-token automation stays in the background preinstall seam.
 */
async function requireAccountsCaller(
  c: Context<SpaceAccessRouteEnv>,
): Promise<AccountsCaller> {
  const caller = await resolveAccountsCaller(c);
  if (!caller) {
    throw new AuthenticationError(
      "Takosumi delegated Workspace authorization is required",
    );
  }
  return caller;
}

function readRequiredIdempotencyKey(
  c: Context<SpaceAccessRouteEnv>,
): string {
  const key = readString(c.req.header("Idempotency-Key"));
  if (!key) {
    throw new BadRequestError(
      "Idempotency-Key is required for a canonical Git lifecycle plan",
    );
  }
  if (
    /[\u0000-\u001f\u007f]/u.test(key) ||
    new TextEncoder().encode(key).byteLength >
      TAKOSUMI_GIT_LIFECYCLE_IDEMPOTENCY_KEY_MAX_BYTES
  ) {
    throw new BadRequestError("Idempotency-Key must be a bounded header value");
  }
  return key;
}

async function applyFeaturedAppCapsuleForRoute(
  c: Context<SpaceAccessRouteEnv>,
  caller: AccountsCaller,
  entry: FeaturedAppCatalogEntry,
  params: { localWorkspaceId: string; idempotencyKey: string },
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
      idempotencyKey: params.idempotencyKey,
      ...(entry.modulePath ? { modulePath: entry.modulePath } : {}),
      ...(hasFeaturedAppVariables(entry) ? { variables: entry.variables } : {}),
    },
    config,
  );
  if (plan.status >= 400) return plan;
  const expected = readCanonicalPlanReference(plan.body);
  return await capsulesRouteDeps.approveAndApplyInstallableAppCapsule(
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
  const caller = await requireAccountsCaller(c);
  return await capsulesRouteDeps.listInstallableAppCapsules(
    accountsCallerWorkspaceId(caller, spaceId),
    callerAccountsConfig(c, caller),
  );
}

async function listInstallableAppCapsuleServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
  capsuleId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await requireAccountsCaller(c);
  return await capsulesRouteDeps.listInstallableAppCapsuleServices(
    capsuleId,
    accountsCallerWorkspaceId(caller, spaceId),
    callerAccountsConfig(c, caller),
  );
}

async function listInstallableAppCapsulesWithServicesForRoute(
  c: Context<SpaceAccessRouteEnv>,
  spaceId: string,
): Promise<InstallableAppUpstreamResponse> {
  const caller = await requireAccountsCaller(c);
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
    const idempotencyKey = readRequiredIdempotencyKey(c);
    const variables = readOptionalBodyVariables(body);
    const caller = await requireAccountsCaller(c);
    const installConfig = callerInstallConfig(c, caller);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Capsule plan Run is not configured",
      );
    }
    const workspaceId = accountsCallerWorkspaceId(caller, space.id);
    const upstream =
      await capsulesRouteDeps.planInstallableAppCapsule(
        {
          ...source,
          workspaceId,
          idempotencyKey,
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

    const caller = await requireAccountsCaller(c);
    const installConfig = callerInstallConfig(c, caller);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Capsule apply is not configured",
      );
    }
    const workspaceId = accountsCallerWorkspaceId(caller, space.id);

    const upstream =
      await capsulesRouteDeps.approveAndApplyInstallableAppCapsule(
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
    const revisionRef =
      operation === "rollback"
        ? (readString(body.state_version_id) ?? readString(body.ref))
        : readString(body.ref);
    if (!revisionRef) {
      throw new BadRequestError(
        operation === "rollback"
          ? "state_version_id is required for rollback"
          : "ref is required for upgrade",
      );
    }
    const idempotencyKey =
      operation === "upgrade" ? readRequiredIdempotencyKey(c) : undefined;
    await assertCapsuleBelongsToSpace(c, space.id, capsuleId);
    const caller = await requireAccountsCaller(c);
    const installConfig = callerInstallConfig(c, caller);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Capsule revision plan Run is not configured",
      );
    }
    const workspaceId = accountsCallerWorkspaceId(caller, space.id);
    const upstream = await capsulesRouteDeps.planInstallableAppRevision(
      {
        workspaceId,
        capsuleId,
        operation,
        ref: revisionRef,
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
    const caller = await requireAccountsCaller(c);
    const installConfig = callerInstallConfig(c, caller);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Capsule revision apply is not configured",
      );
    }
    const workspaceId = accountsCallerWorkspaceId(caller, space.id);
    const upstream =
      await capsulesRouteDeps.approveAndApplyInstallableAppRevision(
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

    readBodyMode(body, entry);
    const idempotencyKey = readRequiredIdempotencyKey(c);
    const caller = await requireAccountsCaller(c);
    const upstream = await applyFeaturedAppCapsuleForRoute(
      c,
      caller,
      entry,
      {
        localWorkspaceId: space.id,
        idempotencyKey,
      },
    );
    if (upstream.status >= 400) return jsonFromUpstream(c, upstream);
    const timestamp = new Date().toISOString();

    return c.json(
      {
        capsule: toCapsuleRecord(entry, upstream.body, {
          timestamp,
        }),
        subject_source: caller.kind,
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
    const caller = await requireAccountsCaller(c);
    const workspaceId = accountsCallerWorkspaceId(caller, space.id);
    const accountsConfig = callerAccountsConfig(c, caller);
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
