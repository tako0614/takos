import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq } from "drizzle-orm";
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";

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
  listInstallableAppInstallations,
  resolveInstallableAppAccountsConfig,
  resolveInstallableAppInstallConfig,
} from "../../application/services/source/installable-app-install.ts";
import { authIdentities, getDb } from "../../infra/db/index.ts";
import type { Env } from "../../shared/types/index.ts";
import {
  parseJsonBody,
  spaceAccess,
  type SpaceAccessRouteEnv,
} from "./route-auth.ts";

type InstallableAppApplyBody = {
  app_id?: unknown;
  git_url?: unknown;
  ref?: unknown;
  mode?: unknown;
  runtime_base_url?: unknown;
  source_commit?: unknown;
  expected_commit?: unknown;
  expected_plan_digest?: unknown;
  expected_current_deployment_id?: unknown;
  expected?: unknown;
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
  resolveTakosumiSubject,
  listInstallableAppInstallations,
  deleteInstallableAppInstallation,
  planInstallableAppInstallation,
  applyInstallableAppInstallation,
  planInstallableAppRevision,
  applyInstallableAppRevision,
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
} | null {
  const gitUrl = readString(body.git_url);
  const ref = readString(body.ref);
  const hasPartialSource = Boolean(gitUrl || ref);
  if (!hasPartialSource) return null;
  if (!gitUrl || !ref) {
    throw new BadRequestError("git_url and ref are required");
  }
  assertBrowserGitUrl(gitUrl);
  return {
    gitUrl,
    ref,
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

function findDefaultAppEntry(
  entries: DefaultAppDistributionEntry[],
  appId: string,
): DefaultAppDistributionEntry | null {
  return entries.find((entry) =>
    entry.appId === appId || entry.name === appId
  ) ??
    null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function listInstallationIds(body: Record<string, unknown> | null): string[] {
  const installations = body?.installations;
  if (!Array.isArray(installations)) return [];
  const ids: string[] = [];
  for (const item of installations) {
    const record = readRecord(item);
    if (!record) continue;
    const id = readString(record.id) ??
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
  const list = await appInstallationsRouteDeps.listInstallableAppInstallations(
    spaceId,
    appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
  );
  if (!listInstallationIds(list.body).includes(installationId)) {
    throw new NotFoundError("Installable app");
  }
}

function readPathString(
  value: unknown,
  path: string[],
): string | null {
  let current: unknown = value;
  for (const segment of path) {
    const record = readRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return readString(current);
}

function readBodyExpectedCommit(body: InstallableAppApplyBody): string | null {
  return readString(body.expected_commit) ??
    readPathString(body.expected, ["commit"]);
}

function readBodyExpectedPlanDigest(
  body: InstallableAppApplyBody,
): string | null {
  return readString(body.expected_plan_digest) ??
    readPathString(body.expected, ["planDigest"]);
}

function readBodyExpectedCurrentDeploymentId(
  body: InstallableAppApplyBody,
): { provided: boolean; value: string | null } {
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
  return readPathString(value, ["accounts", "installationId"]) ??
    readPathString(value, ["accounts", "installation_id"]) ??
    readPathString(value, ["installation", "id"]) ??
    readPathString(value, ["installation", "installation_id"]) ??
    readPathString(value, ["installationId"]) ??
    readPathString(value, ["installation_id"]);
}

function extractInstallationStatus(value: unknown): string {
  return readPathString(value, ["installation", "status"]) ??
    readPathString(value, ["accounts", "status"]) ??
    readPathString(value, ["status"]) ??
    "installing";
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

function subjectFromProviderSub(providerSub: string): string | null {
  const marker = providerSub.lastIndexOf("#");
  if (marker < 0 || marker === providerSub.length - 1) return null;
  return providerSub.slice(marker + 1);
}

async function resolveTakosumiSubject(
  env: Env,
  userId: string,
): Promise<string | null> {
  const row = await getDb(env.DB).select({
    providerSub: authIdentities.providerSub,
  }).from(authIdentities)
    .where(and(
      eq(authIdentities.userId, userId),
      eq(authIdentities.provider, "oidc"),
    ))
    .orderBy(desc(authIdentities.lastLoginAt))
    .limit(1)
    .get();
  return row ? subjectFromProviderSub(row.providerSub) : null;
}

const appInstallationsRouter = new Hono<SpaceAccessRouteEnv>();

appInstallationsRouter.get(
  "/spaces/:spaceId/app-installations",
  spaceAccess({ roles: ["owner", "admin", "editor", "viewer"] }),
  async (c) => {
    const { space } = c.get("access");
    const upstream = await appInstallationsRouteDeps
      .listInstallableAppInstallations(
        space.id,
        appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
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
    const installConfig = appInstallationsRouteDeps
      .resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation PlanRun is not configured",
      );
    }
    const upstream = await appInstallationsRouteDeps
      .planInstallableAppInstallation({
        ...source,
        spaceId: space.id,
      }, installConfig);
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/git-url/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const user = c.get("user");
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
    const expectedCommit = readBodyExpectedCommit(body) ?? undefined;
    const expectedPlanDigest = readBodyExpectedPlanDigest(
      body,
    ) ?? undefined;
    if (!expectedCommit || !expectedPlanDigest) {
      throw new BadRequestError(
        "expected_commit and expected_plan_digest are required after install PlanRun approval",
      );
    }

    const installConfig = appInstallationsRouteDeps
      .resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation apply is not configured",
      );
    }
    const subject = await appInstallationsRouteDeps
      .resolveTakosumiSubject(c.env, user.id) ?? installConfig.subject;
    if (!subject) {
      throw new ServiceUnavailableError(
        "Third-party Installation subject is not configured",
      );
    }
    const mode = readOptionalBodyMode(body) ?? installConfig.mode;
    const runtimeBaseUrl = readOptionalBodyRuntimeBaseUrl(body) ??
      installConfig.runtimeBaseUrl;

    const upstream = await appInstallationsRouteDeps
      .applyInstallableAppInstallation({
        ...source,
        accountId: installConfig.accountId ?? space.id,
        spaceId: space.id,
        subject,
        ...(mode ? { mode } : {}),
        ...(runtimeBaseUrl ? { runtimeBaseUrl } : {}),
        ...(expectedCommit ? { expectedCommit } : {}),
        ...(expectedPlanDigest ? { expectedPlanDigest } : {}),
        ...(costAck === undefined ? {} : { costAck }),
      }, installConfig);
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
    const installConfig = appInstallationsRouteDeps
      .resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation deployment PlanRun is not configured",
      );
    }
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const sourceCommit = readString(body.source_commit) ?? undefined;
    const reason = readString(body.reason) ?? undefined;
    const upstream = await appInstallationsRouteDeps
      .planInstallableAppRevision({
        ...source,
        installationId,
        operation,
        ...(sourceCommit ? { sourceCommit } : {}),
        ...(reason ? { reason } : {}),
      }, installConfig);
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
    const installConfig = appInstallationsRouteDeps
      .resolveInstallableAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Third-party Installation deployment apply is not configured",
      );
    }
    await assertInstallationBelongsToSpace(c, space.id, installationId);
    const sourceCommit = readString(body.source_commit) ?? undefined;
    const reason = readString(body.reason) ?? undefined;
    const expectedCommit = readBodyExpectedCommit(body) ?? undefined;
    const expectedPlanDigest = readBodyExpectedPlanDigest(
      body,
    ) ?? undefined;
    const expectedCurrentDeploymentId = readBodyExpectedCurrentDeploymentId(
      body,
    );
    if (
      operation === "upgrade" &&
      (!expectedCommit || !expectedPlanDigest ||
        !expectedCurrentDeploymentId.provided)
    ) {
      throw new BadRequestError(
        "expected.commit, expected.planDigest, and expected.currentDeploymentId are required after deployment PlanRun approval",
      );
    }
    const upstream = await appInstallationsRouteDeps
      .applyInstallableAppRevision({
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
      }, installConfig);
    return jsonFromUpstream(c, upstream);
  },
);

appInstallationsRouter.post(
  "/spaces/:spaceId/app-installations/apply",
  spaceAccess({ roles: ["owner", "admin", "editor"] }),
  async (c) => {
    const user = c.get("user");
    const { space } = c.get("access");
    const body = await parseJsonBody<InstallableAppApplyBody>(c, {});
    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }

    const appId = readBodyAppId(body);
    const entries = await appInstallationsRouteDeps
      .resolveDefaultAppDistributionForBootstrap(c.env);
    const entry = findDefaultAppEntry(entries, appId);
    if (!entry?.appId) {
      throw new NotFoundError("Installable app");
    }

    const installConfig = appInstallationsRouteDeps
      .resolveDefaultAppInstallConfig(c.env);
    if (!installConfig) {
      throw new ServiceUnavailableError(
        "Installation install is not configured",
      );
    }

    const mode = readBodyMode(body, entry);
    const subject = await appInstallationsRouteDeps
      .resolveTakosumiSubject(c.env, user.id) ?? installConfig.subject;
    const upstream = await appInstallationsRouteDeps
      .applyDefaultAppInstallation(
        entry,
        installConfig,
        {
          spaceId: space.id,
          createdByAccountId: space.id,
          subject,
          ...(mode ? { mode } : {}),
        },
      );
    const timestamp = new Date().toISOString();

    return c.json({
      installation: toInstallationRecord(entry, upstream, {
        mode: mode ?? installConfig.mode ?? null,
        timestamp,
      }),
      subject_source: subject === installConfig.subject
        ? "operator_config"
        : "takosumi_oidc",
    }, 202);
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
    const reason = body === null ? undefined : readString(body.reason) ??
      undefined;
    const upstream = await appInstallationsRouteDeps
      .deleteInstallableAppInstallation(
        installationId,
        appInstallationsRouteDeps.resolveInstallableAppAccountsConfig(c.env),
        reason,
      );
    return jsonFromUpstream(c, upstream);
  },
);

export default appInstallationsRouter;
