import { type Context, Hono } from "hono";
import { and, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import {
  appDeployments,
  appTokens,
  deployments,
  getDb,
  groups,
  resources,
  services,
} from "../../../infra/db/index.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import {
  applyManifest,
  type ApplyManifestOpts,
  buildSafeApplyResult,
  getGroupState,
  planManifest,
} from "../../../application/services/deployment/apply-engine.ts";
import {
  createGroupByName,
  findGroupByName,
  type GroupProviderName,
  type GroupRow,
  type GroupSourceProjectionInput,
  updateGroupMetadata,
  updateGroupSourceProjection,
} from "../../../application/services/groups/records.ts";
import {
  normalizeRepositoryUrl,
  type RepoRefType,
} from "../../../application/services/platform/app-deployment-source.ts";
import {
  parseAppManifestText,
  parseAppManifestYaml,
} from "../../../application/services/source/app-manifest-parser/index.ts";
import { getUpdateType } from "../../../application/services/deployment/store-install.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import type { AppManifest } from "../../../application/services/source/app-manifest-types.ts";
import { AppDeploymentService } from "../../../application/services/platform/app-deployments.ts";

type GroupsContext = Context<SpaceAccessRouteEnv>;
type GroupRouteBody = Record<string, unknown>;
type GroupMetadataOverrides = {
  providerProvided: boolean;
  provider: GroupProviderName | null;
  envProvided: boolean;
  envName: string | null;
};
type ParsedGroupDeployRequest = GroupMetadataOverrides & {
  manifest: AppManifest | undefined;
  source: GroupSourceProjectionInput | null;
};
const GROUP_PROVIDER_VALUES = [
  "cloudflare",
  "local",
  "aws",
  "gcp",
  "k8s",
] as const;

export const groupsRouteDeps = {
  getDb,
  getGroupState,
  planManifest,
  applyManifest,
  parseAppManifestYaml,
};

function groupRecordDeps() {
  return { getDb: groupsRouteDeps.getDb };
}

function parseGroupProvider(raw: unknown): GroupProviderName | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new BadRequestError(`Invalid provider: ${String(raw)}`);
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new BadRequestError("provider must be a non-empty string");
  }
  if (!GROUP_PROVIDER_VALUES.includes(normalized as GroupProviderName)) {
    throw new BadRequestError(`Invalid provider: ${raw}`);
  }
  return normalized as GroupProviderName;
}

function parseGroupEnv(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new BadRequestError(`Invalid env: ${String(raw)}`);
  }
  const normalized = raw.trim();
  if (!normalized) {
    throw new BadRequestError("env must be a non-empty string");
  }
  return normalized;
}

function requireNonEmptyString(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new BadRequestError(`${field} is required`);
  }
  return raw.trim();
}

function normalizeGroupSourceRepositoryUrl(raw: string): string {
  try {
    return normalizeRepositoryUrl(raw);
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw new BadRequestError(
        error.message.replace(/^repository_url\b/, "source.repository_url"),
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

function getGroupIdParam(c: GroupsContext): string {
  const groupId = c.req.param("groupId");
  if (!groupId) throw new BadRequestError("groupId param is required");
  return groupId;
}

function hasOwn(body: GroupRouteBody, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  return safeJsonParseOrDefault<T | null>(value, null);
}

function toApiGroup(group: {
  id: string;
  spaceId: string;
  name: string;
  appVersion: string | null;
  provider: string | null;
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  currentAppDeploymentId: string | null;
  desiredSpecJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...group,
    desiredSpecJson: parseJsonField(group.desiredSpecJson),
    providerStateJson: parseJsonField(group.providerStateJson),
  };
}

function parseDesiredManifestInput(raw: unknown): AppManifest {
  if (!raw) {
    throw new BadRequestError("desired manifest body is required");
  }
  try {
    return parseAppManifestText(JSON.stringify(raw));
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error
        ? error.message
        : "desired state must be a valid app manifest document",
    );
  }
}

function parseRequestManifest(raw: unknown): AppManifest | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    return groupsRouteDeps.parseAppManifestYaml(raw);
  }
  return raw as AppManifest;
}

function parseGroupMetadataOverrides(
  body: GroupRouteBody,
): GroupMetadataOverrides {
  const providerProvided = hasOwn(body, "provider");
  const envProvided = hasOwn(body, "env");
  return {
    providerProvided,
    provider: providerProvided ? parseGroupProvider(body.provider) : null,
    envProvided,
    envName: envProvided ? parseGroupEnv(body.env) : null,
  };
}

function parseGroupDeployRequest(
  body: GroupRouteBody,
): ParsedGroupDeployRequest {
  return {
    ...parseGroupMetadataOverrides(body),
    manifest: parseRequestManifest(body.manifest),
    source: parseGroupSourceProjection(body.source),
  };
}

function resolveGroupName(
  raw: unknown,
  manifest?: AppManifest,
): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof manifest?.name === "string" && manifest.name.trim().length > 0) {
    return manifest.name.trim();
  }
  throw new BadRequestError("group_name is required");
}

function parseRepoRefType(raw: unknown): RepoRefType | null {
  if (raw === undefined || raw === null) return null;
  if (raw !== "branch" && raw !== "tag" && raw !== "commit") {
    throw new BadRequestError("source.ref_type must be branch, tag, or commit");
  }
  return raw;
}

function parseGroupSourceProjection(
  raw: unknown,
): GroupSourceProjectionInput | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") {
    throw new BadRequestError("source must be an object");
  }

  const source = raw as Record<string, unknown>;
  const kind = typeof source.kind === "string" ? source.kind.trim() : "";
  if (kind === "local_upload") {
    return { kind: "local_upload" };
  }
  if (kind === "git_ref") {
    const repositoryUrl = typeof source.repository_url === "string"
      ? normalizeGroupSourceRepositoryUrl(source.repository_url)
      : "";
    if (!repositoryUrl) {
      throw new BadRequestError("source.repository_url is required");
    }
    return {
      kind: "git_ref",
      repositoryUrl,
      ref: typeof source.ref === "string" && source.ref.trim().length > 0
        ? source.ref.trim()
        : null,
      refType: parseRepoRefType(source.ref_type),
      commitSha: typeof source.commit_sha === "string" &&
          source.commit_sha.trim().length > 0
        ? source.commit_sha.trim()
        : null,
    };
  }

  throw new BadRequestError("source.kind must be git_ref or local_upload");
}

function buildUninstallManifest(group: GroupRow): AppManifest {
  return {
    name: group.name,
    ...(group.appVersion ? { version: group.appVersion } : {}),
    compute: {},
    routes: [],
    publish: [],
    env: {},
  };
}

async function assertGroupNameAvailable(
  env: Env,
  spaceId: string,
  groupName: string,
  excludeGroupId?: string,
): Promise<void> {
  const existing = await findGroupByName(
    env,
    spaceId,
    groupName,
    groupRecordDeps(),
  );
  if (existing && existing.id !== excludeGroupId) {
    throw new BadRequestError(
      `Group "${groupName}" already exists in this workspace`,
    );
  }
}

async function findGroupInSpaceByName(
  env: Env,
  spaceId: string,
  groupName: string,
): Promise<GroupRow | null> {
  return findGroupByName(env, spaceId, groupName, groupRecordDeps());
}

async function requireGroupInSpace(c: GroupsContext) {
  const { space } = c.get("access");
  const db = groupsRouteDeps.getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const group = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.spaceId, space.id)))
    .get();
  if (!group) throw new NotFoundError("Group");
  return group;
}

async function requireGroupByNameInSpace(
  env: Env,
  spaceId: string,
  groupName: string,
): Promise<GroupRow> {
  const group = await findGroupInSpaceByName(env, spaceId, groupName);
  if (!group) throw new NotFoundError("Group");
  return group;
}

async function applyGroupMetadataOverrides(
  env: Env,
  group: GroupRow,
  overrides: GroupMetadataOverrides,
): Promise<GroupRow> {
  if (!overrides.providerProvided && !overrides.envProvided) {
    return group;
  }
  return updateGroupMetadata(
    env,
    group.id,
    {
      provider: overrides.providerProvided ? overrides.provider : undefined,
      envName: overrides.envProvided ? overrides.envName : undefined,
    },
    groupRecordDeps(),
  );
}

async function updatePersistedGroupMetadata(
  c: GroupsContext,
  group: GroupRow,
  body: GroupRouteBody,
): Promise<GroupRow> {
  const { space } = c.get("access");
  const nextName = typeof body.name === "string" && body.name.trim().length > 0
    ? body.name.trim()
    : group.name;
  await assertGroupNameAvailable(c.env, space.id, nextName, group.id);

  const db = groupsRouteDeps.getDb(c.env.DB);
  await db.update(groups)
    .set({
      name: nextName,
      provider: hasOwn(body, "provider")
        ? parseGroupProvider(body.provider)
        : group.provider,
      env: hasOwn(body, "env") ? parseGroupEnv(body.env) : group.env,
      appVersion: typeof body.appVersion === "string"
        ? body.appVersion
        : group.appVersion,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(groups.id, group.id))
    .run();

  return await requireGroupInSpace(c);
}

function assertManifestProvidedForMissingGroup(
  group: GroupRow | null,
  groupName: string,
  manifest?: AppManifest,
): void {
  if (!group && !manifest) {
    throw new BadRequestError(
      `Group "${groupName}" does not exist and no manifest was provided`,
    );
  }
}

function hasFailedApplyEntries(
  result: ReturnType<typeof buildSafeApplyResult>,
): boolean {
  return result.applied.some((entry) => entry.status === "failed");
}

async function syncGroupSourceProjection(
  env: Env,
  groupId: string,
  source: GroupSourceProjectionInput | null,
  result: ReturnType<typeof buildSafeApplyResult>,
): Promise<void> {
  if (!source || hasFailedApplyEntries(result)) {
    return;
  }
  await updateGroupSourceProjection(env, groupId, source, groupRecordDeps());
}

async function resolveNamedManifestGroup(
  c: GroupsContext,
  body: GroupRouteBody,
  manifest?: AppManifest,
): Promise<{ groupName: string; group: GroupRow | null }> {
  const { space } = c.get("access");
  const groupName = resolveGroupName(body.group_name, manifest);
  const group = await findGroupInSpaceByName(c.env, space.id, groupName);
  assertManifestProvidedForMissingGroup(group, groupName, manifest);
  return { groupName, group };
}

function buildPlanOptions(
  groupName: string,
  currentProvider: string | null | undefined,
  overrides: GroupMetadataOverrides,
) {
  return {
    groupName,
    providerName: overrides.provider ?? currentProvider ?? undefined,
    envName: overrides.envProvided ? overrides.envName ?? undefined : undefined,
  };
}

function countObservedInventory(
  observed:
    | {
      resources?: Record<string, unknown>;
      workloads?: Record<string, unknown>;
      routes?: Record<string, unknown>;
    }
    | null
    | undefined,
): number {
  return Object.keys(observed?.resources ?? {}).length +
    Object.keys(observed?.workloads ?? {}).length +
    Object.keys(observed?.routes ?? {}).length;
}

async function applyManifestForGroup(
  env: Env,
  group: Pick<GroupRow, "id" | "name">,
  manifest: AppManifest | undefined,
  input: {
    artifacts?: ApplyManifestOpts["artifacts"];
    target?: ApplyManifestOpts["target"];
    groupName?: string;
    envName?: string;
    source?: GroupSourceProjectionInput | null;
  },
) {
  const result = await groupsRouteDeps.applyManifest(
    env,
    group.id,
    manifest,
    {
      artifacts: input.artifacts,
      target: input.target,
      groupName: input.groupName,
      envName: input.envName,
    },
  );
  const safeResult = buildSafeApplyResult(result);
  await syncGroupSourceProjection(
    env,
    group.id,
    input.source ?? null,
    safeResult,
  );
  return safeResult;
}

async function revokeGroupTokensAndDelete(
  env: Env,
  groupId: string,
): Promise<void> {
  const db = groupsRouteDeps.getDb(env.DB);
  await db.update(appTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(appTokens.groupId, groupId), isNull(appTokens.revokedAt)))
    .run();
  await db.delete(groups).where(eq(groups.id, groupId));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listGroupsHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select().from(groups).where(
    eq(groups.spaceId, space.id),
  );
  return c.json({ groups: result.map((group) => toApiGroup(group)) });
}

async function createGroupHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const body = await c.req.json<GroupRouteBody>();
  const overrides = parseGroupMetadataOverrides(body);
  const group = await createGroupByName(c.env, {
    spaceId: space.id,
    groupName: requireNonEmptyString(body.name, "name"),
    provider: overrides.providerProvided ? overrides.provider : null,
    envName: overrides.envProvided ? overrides.envName : null,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
    manifest: body.desiredSpecJson ?? null,
  }, groupRecordDeps());
  return c.json({ id: group.id, name: group.name }, 201);
}

async function getGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
  const apiGroup = toApiGroup(group);
  return c.json({
    ...apiGroup,
    observed,
    inventory: observed
      ? {
        resources: Object.values(observed.resources),
        workloads: Object.values(observed.workloads),
        routes: Object.values(observed.routes),
      }
      : { resources: [], workloads: [], routes: [] },
  });
}

async function patchGroupMetadataHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const updated = await updatePersistedGroupMetadata(c, group, body);
  return c.json({ group: toApiGroup(updated) });
}

async function getGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  return c.json({
    desired: parseJsonField<AppManifest>(group.desiredSpecJson),
  });
}

async function putGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const desired = parseDesiredManifestInput(await c.req.json());

  const db = groupsRouteDeps.getDb(c.env.DB);
  const now = new Date().toISOString();
  await db.update(groups)
    .set({
      appVersion: desired.version ?? null,
      desiredSpecJson: JSON.stringify(desired),
      updatedAt: now,
    })
    .where(eq(groups.id, group.id))
    .run();

  const updated = await requireGroupInSpace(c);
  return c.json({ group: toApiGroup(updated), desired });
}

async function deleteGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const ownedResources = await db.select({ id: resources.id })
    .from(resources)
    .where(
      and(eq(resources.groupId, group.id), ne(resources.status, "deleted")),
    )
    .all();
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();

  if (ownedResources.length > 0 || ownedServices.length > 0) {
    throw new BadRequestError(
      "Group still owns resources or services. Apply an empty manifest before deleting the group.",
    );
  }

  await revokeGroupTokensAndDelete(c.env, group.id);
  return c.json({ deleted: true });
}

async function listGroupResourcesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select()
    .from(resources)
    .where(
      and(eq(resources.groupId, group.id), ne(resources.status, "deleted")),
    )
    .all();
  return c.json({
    resources: result.map((resource) => ({
      ...resource,
      config: parseJsonField(resource.config) ?? {},
      metadata: parseJsonField(resource.metadata) ?? {},
    })),
  });
}

async function listGroupServicesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select()
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();
  return c.json({
    services: result.map((service) => ({
      ...service,
      config: parseJsonField(service.config) ?? {},
    })),
  });
}

async function listGroupDeploymentsHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();
  const serviceIds = ownedServices.map((service) => service.id);

  if (serviceIds.length === 0) {
    return c.json({ deployments: [] });
  }

  const result = await db.select()
    .from(deployments)
    .where(inArray(deployments.serviceId, serviceIds))
    .all();
  return c.json({ deployments: result });
}

// ---------------------------------------------------------------------------
// Deployment: plan / apply / updates
// ---------------------------------------------------------------------------

async function planGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group.id,
    input.manifest,
    buildPlanOptions(group.name, group.provider, input),
  );
  return c.json(result);
}

async function planGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  const { groupName, group } = await resolveNamedManifestGroup(
    c,
    body,
    input.manifest,
  );

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group?.id ?? null,
    input.manifest,
    buildPlanOptions(groupName, group?.provider, input),
  );
  return c.json({
    group: {
      id: group?.id ?? null,
      name: groupName,
      exists: !!group,
    },
    ...result,
  });
}

async function applyGroupHandler(c: GroupsContext) {
  let group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  group = await applyGroupMetadataOverrides(c.env, group, input);

  const safeResult = await applyManifestForGroup(
    c.env,
    group,
    input.manifest,
    {
      artifacts: body.artifacts as ApplyManifestOpts["artifacts"],
      target: body.target as ApplyManifestOpts["target"],
      envName: input.envProvided ? input.envName ?? undefined : undefined,
      source: input.source,
    },
  );
  return c.json(safeResult);
}

async function applyGroupByNameHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  const { groupName, group: existingGroup } = await resolveNamedManifestGroup(
    c,
    body,
    input.manifest,
  );
  let group = existingGroup;
  if (group) {
    group = await applyGroupMetadataOverrides(c.env, group, input);
  }

  const finalGroup = group ?? await createGroupByName(c.env, {
    spaceId: space.id,
    groupName,
    provider: input.providerProvided ? input.provider : undefined,
    envName: input.envProvided ? input.envName : undefined,
    appVersion: typeof input.manifest?.version === "string"
      ? input.manifest.version
      : null,
    manifest: input.manifest,
  }, groupRecordDeps());

  const safeResult = await applyManifestForGroup(
    c.env,
    finalGroup,
    input.manifest,
    {
      artifacts: body.artifacts as ApplyManifestOpts["artifacts"],
      target: body.target as ApplyManifestOpts["target"],
      groupName: finalGroup.name,
      envName: input.envProvided ? input.envName ?? undefined : undefined,
      source: input.source,
    },
  );
  return c.json({
    group: { id: finalGroup.id, name: finalGroup.name },
    ...safeResult,
  });
}

async function uninstallGroupByNameHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const body = await c.req.json<GroupRouteBody>();
  const groupName = resolveGroupName(body.group_name);
  const group = await requireGroupByNameInSpace(c.env, space.id, groupName);

  const safeResult = await applyManifestForGroup(
    c.env,
    group,
    buildUninstallManifest(group),
    {
      groupName: group.name,
      envName: group.env ?? undefined,
    },
  );
  if (hasFailedApplyEntries(safeResult)) {
    throw new ConflictError(
      "Uninstall failed. Managed resources were not fully removed.",
    );
  }

  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
  const inventoryCount = countObservedInventory(observed);
  if (inventoryCount > 0) {
    throw new ConflictError(
      "Uninstall did not fully drain group-managed inventory",
    );
  }

  await revokeGroupTokensAndDelete(c.env, group.id);

  return c.json({
    group: { id: group.id, name: group.name },
    apply_result: safeResult,
    uninstalled: true,
    deleted_group: true,
  });
}

async function updatesGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);

  const latest = c.req.query("latestVersion");
  if (!latest || !group.appVersion) {
    return c.json({
      available: false,
      currentVersion: group.appVersion,
      latestVersion: latest ?? null,
    });
  }

  const updateType = getUpdateType(group.appVersion, latest);
  return c.json({
    available: group.appVersion !== latest,
    currentVersion: group.appVersion,
    latestVersion: latest,
    updateType,
  });
}

async function rollbackGroupHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const user = c.get("user");
  if (!user) {
    throw new BadRequestError("Authentication required");
  }
  const group = await requireGroupInSpace(c);
  if (!group.currentAppDeploymentId) {
    throw new ConflictError(
      "Group has no current app deployment to roll back",
    );
  }
  const currentDeploymentId = group.currentAppDeploymentId;

  // Resolve the prior successful deployment so the response can advertise the
  // version we are rolling back TO. This mirrors the workers rollback shape
  // (`rolled_back_to` is the previous successful deployment, not the current).
  const db = groupsRouteDeps.getDb(c.env.DB);
  const currentRow = await db.select().from(appDeployments).where(and(
    eq(appDeployments.id, currentDeploymentId),
    eq(appDeployments.spaceId, space.id),
    ne(appDeployments.status, "deleted"),
  )).get();
  if (!currentRow) {
    throw new NotFoundError("App deployment");
  }
  const previousRow = await db.select().from(appDeployments).where(and(
    eq(appDeployments.spaceId, space.id),
    eq(appDeployments.groupId, currentRow.groupId),
    eq(appDeployments.status, "applied"),
    ne(appDeployments.id, currentRow.id),
    lt(appDeployments.createdAt, currentRow.createdAt),
  )).orderBy(desc(appDeployments.createdAt)).get();
  if (!previousRow) {
    throw new ConflictError(
      "No previous successful deployment to roll back to",
    );
  }

  const result = await new AppDeploymentService(c.env).rollback(
    space.id,
    user.id,
    currentDeploymentId,
  );
  return c.json({
    group_id: group.id,
    deployment_id: result.appDeployment.id,
    rolled_back_to: previousRow.id,
    app_deployment: result.appDeployment,
    apply_result: result.applyResult,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const groupsRouter = new Hono<{ Bindings: Env }>();

// Group CRUD
groupsRouter
  .get("/spaces/:spaceId/groups", spaceAccess(), listGroupsHandler)
  .post(
    "/spaces/:spaceId/groups",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    createGroupHandler,
  )
  .post(
    "/spaces/:spaceId/groups/plan",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    planGroupByNameHandler,
  )
  .post(
    "/spaces/:spaceId/groups/apply",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    applyGroupByNameHandler,
  )
  .post(
    "/spaces/:spaceId/groups/uninstall",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    uninstallGroupByNameHandler,
  )
  .get("/spaces/:spaceId/groups/:groupId", spaceAccess(), getGroupHandler)
  .patch(
    "/spaces/:spaceId/groups/:groupId/metadata",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    patchGroupMetadataHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/desired",
    spaceAccess(),
    getGroupDesiredHandler,
  )
  .put(
    "/spaces/:spaceId/groups/:groupId/desired",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    putGroupDesiredHandler,
  )
  .delete(
    "/spaces/:spaceId/groups/:groupId",
    spaceAccess({ roles: ["owner", "admin"] }),
    deleteGroupHandler,
  )
  // Canonical group inventory
  .get(
    "/spaces/:spaceId/groups/:groupId/resources",
    spaceAccess(),
    listGroupResourcesHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/services",
    spaceAccess(),
    listGroupServicesHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/deployments",
    spaceAccess(),
    listGroupDeploymentsHandler,
  )
  // Deployment: plan / apply / updates
  .post(
    "/spaces/:spaceId/groups/:groupId/plan",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    planGroupHandler,
  )
  .post(
    "/spaces/:spaceId/groups/:groupId/apply",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    applyGroupHandler,
  )
  .post(
    "/spaces/:spaceId/groups/:groupId/rollback",
    spaceAccess({ roles: ["owner", "admin", "editor"] }),
    rollbackGroupHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/updates",
    spaceAccess(),
    updatesGroupHandler,
  );

export default groupsRouter;
