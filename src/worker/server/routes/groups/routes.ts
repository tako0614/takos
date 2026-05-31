import { type Context, Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { getDb, groups, resources, services } from "../../../infra/db/index.ts";
import {
  BadRequestError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
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
  type GroupRow,
  type GroupSourceProjectionInput,
  updateGroupMetadata,
  updateGroupSourceProjection,
} from "../../../application/services/groups/records.ts";
import {
  normalizeRepositoryUrl,
  type RepoRefType,
} from "../../../application/services/platform/repository-source.ts";
import {
  assertManifestInputDoesNotUseBuildMetadata,
  parseAppManifestText,
  parseAppManifestYaml,
} from "../../../application/services/source/app-manifest-parser/index.ts";
import { getUpdateType } from "../../../application/services/deployment/store-install.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import type { AppManifest } from "../../../application/services/source/app-manifest-types.ts";
import type { TranslationReport } from "../../../application/services/deployment/translation-report.ts";
import { stripPublicInternalFields } from "../response-utils.ts";

type GroupsContext = Context<SpaceAccessRouteEnv>;
type GroupRouteBody = Record<string, unknown>;
type GroupMetadataOverrides = {
  envProvided: boolean;
  envName: string | null;
};
type ParsedGroupDeployRequest = GroupMetadataOverrides & {
  manifest: AppManifest | undefined;
  source: GroupSourceProjectionInput | null;
};

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

function hasPublicBackendField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasPublicBackendField(entry));
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "backend" || key === "backendName" || key === "backend_name" ||
      key === "backendState" || key === "backendStateJson" ||
      key === "backend_state" || key === "backend_state_json"
    ) {
      return true;
    }
    if (hasPublicBackendField(entry)) return true;
  }
  return false;
}

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  return safeJsonParseOrDefault<T | null>(value, null);
}

function assertNoPublicBackendInput(body: GroupRouteBody): void {
  if (
    hasOwn(body, "backend") ||
    hasOwn(body, "backendName") || hasOwn(body, "backend_name") ||
    hasOwn(body, "backendState") || hasOwn(body, "backendStateJson") ||
    hasOwn(body, "backend_state") || hasOwn(body, "backend_state_json")
  ) {
    throw new BadRequestError(
      "retired backend fields are not accepted on public group routes",
    );
  }
}

function toApiGroup(group: {
  id: string;
  spaceId: string;
  name: string;
  appVersion: string | null;
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  desiredSpecJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: group.id,
    spaceId: group.spaceId,
    name: group.name,
    appVersion: group.appVersion,
    env: group.env,
    sourceKind: group.sourceKind,
    sourceRepositoryUrl: group.sourceRepositoryUrl,
    sourceRef: group.sourceRef,
    sourceRefType: group.sourceRefType,
    sourceCommitSha: group.sourceCommitSha,
    desiredSpecJson: stripPublicInternalFields(
      parseJsonField(group.desiredSpecJson),
    ),
    reconcileStatus: group.reconcileStatus,
    lastAppliedAt: group.lastAppliedAt,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toApiGroupState(
  observed: Awaited<ReturnType<typeof groupsRouteDeps.getGroupState>>,
) {
  if (!observed) return null;
  const { backend: _backend, ...apiObserved } = observed;
  return stripPublicInternalFields(apiObserved);
}

function toApiTranslationReport(report: TranslationReport) {
  return stripPublicInternalFields(report);
}

function toApiResult<T extends { translationReport: TranslationReport }>(
  result: T,
) {
  return {
    ...result,
    translationReport: toApiTranslationReport(result.translationReport),
  };
}

function parseDesiredManifestInput(raw: unknown, _env: Env): AppManifest {
  if (!raw) {
    throw new BadRequestError("desired manifest body is required");
  }
  if (hasPublicBackendField(raw)) {
    throw new BadRequestError("desired state must not contain backend fields");
  }
  try {
    const manifest = parseAppManifestText(JSON.stringify(raw));
    if (hasPublicBackendField(manifest)) {
      throw new BadRequestError(
        "desired state must not contain backend fields",
      );
    }
    return manifest;
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error
        ? error.message
        : "desired state must be a valid app manifest document",
    );
  }
}

function parseRequestManifest(
  raw: unknown,
  _env: Env,
): AppManifest | undefined {
  if (raw === undefined) return undefined;
  if (hasPublicBackendField(raw)) {
    throw new BadRequestError("manifest must not contain backend fields");
  }
  try {
    if (typeof raw === "string") {
      const manifest = groupsRouteDeps.parseAppManifestYaml(raw);
      if (hasPublicBackendField(manifest)) {
        throw new BadRequestError("manifest must not contain backend fields");
      }
      return manifest;
    }
    assertManifestInputDoesNotUseBuildMetadata(raw);
    return raw as AppManifest;
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError(
      error instanceof Error
        ? error.message
        : "manifest must be a valid app manifest document",
    );
  }
}

function parseGroupMetadataOverrides(
  body: GroupRouteBody,
): GroupMetadataOverrides {
  assertNoPublicBackendInput(body);
  const envProvided = hasOwn(body, "env");
  return {
    envProvided,
    envName: envProvided ? parseGroupEnv(body.env) : null,
  };
}

function parseGroupDeployRequest(
  body: GroupRouteBody,
  env: Env,
): ParsedGroupDeployRequest {
  return {
    ...parseGroupMetadataOverrides(body),
    manifest: parseRequestManifest(body.manifest, env),
    source: parseGroupSourceProjection(body.source),
  };
}

function resolveGroupName(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
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
  if (hasPublicBackendField(source)) {
    throw new BadRequestError("source must not contain backend fields");
  }
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
      `Group "${groupName}" already exists in this space`,
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

async function applyGroupMetadataOverrides(
  env: Env,
  group: GroupRow,
  overrides: GroupMetadataOverrides,
): Promise<GroupRow> {
  if (!overrides.envProvided) {
    return group;
  }
  return updateGroupMetadata(
    env,
    group.id,
    {
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
  assertNoPublicBackendInput(body);
  const { space } = c.get("access");
  const nextName = typeof body.name === "string" && body.name.trim().length > 0
    ? body.name.trim()
    : group.name;
  await assertGroupNameAvailable(c.env, space.id, nextName, group.id);

  const db = groupsRouteDeps.getDb(c.env.DB);
  await db.update(groups)
    .set({
      name: nextName,
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
  if (hasFailedApplyEntries(result)) {
    return;
  }
  await updateGroupSourceProjection(
    env,
    groupId,
    source ?? { kind: "local_upload" },
    groupRecordDeps(),
  );
}

async function resolveNamedManifestGroup(
  c: GroupsContext,
  body: GroupRouteBody,
  manifest?: AppManifest,
): Promise<{ groupName: string; group: GroupRow | null }> {
  const { space } = c.get("access");
  const groupName = resolveGroupName(body.group_name);
  const group = await findGroupInSpaceByName(c.env, space.id, groupName);
  assertManifestProvidedForMissingGroup(group, groupName, manifest);
  return { groupName, group };
}

function buildPlanOptions(
  groupName: string,
  currentBackendName: string | null | undefined,
  overrides: GroupMetadataOverrides,
) {
  return {
    groupName,
    backendName: currentBackendName ?? undefined,
    envName: overrides.envProvided ? overrides.envName ?? undefined : undefined,
  };
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
  await db.delete(groups).where(eq(groups.id, groupId)).run();
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
    backendName: null,
    envName: overrides.envProvided ? overrides.envName : null,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
    manifest: body.desiredSpecJson ?? null,
  }, groupRecordDeps());
  return c.json({ id: group.id, name: group.name }, 201);
}

async function getGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
  const apiObserved = toApiGroupState(observed);
  const apiGroup = toApiGroup(group);
  return c.json({
    ...apiGroup,
    observed: apiObserved,
    inventory: observed
      ? {
        resources: stripPublicInternalFields(Object.values(observed.resources)),
        workloads: stripPublicInternalFields(Object.values(observed.workloads)),
        routes: stripPublicInternalFields(Object.values(observed.routes)),
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
    desired: stripPublicInternalFields(
      parseJsonField<AppManifest>(group.desiredSpecJson),
    ),
  });
}

async function putGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const desired = parseDesiredManifestInput(await c.req.json(), c.env);

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
  return c.json({
    group: toApiGroup(updated),
    desired: stripPublicInternalFields(desired),
  });
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
      ...stripPublicInternalFields(resource),
      config: stripPublicInternalFields(parseJsonField(resource.config) ?? {}),
      metadata: stripPublicInternalFields(
        parseJsonField(resource.metadata) ?? {},
      ),
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
      ...stripPublicInternalFields(service),
      config: stripPublicInternalFields(parseJsonField(service.config) ?? {}),
    })),
  });
}

// ---------------------------------------------------------------------------
// Deployment: plan / apply / updates
// ---------------------------------------------------------------------------

async function planGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body, c.env);

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group.id,
    input.manifest,
    {
      ...buildPlanOptions(group.name, group.backend, input),
      target: body.target as ApplyManifestOpts["target"],
    },
  );
  return c.json(toApiResult(result));
}

async function planGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body, c.env);
  const { groupName, group } = await resolveNamedManifestGroup(
    c,
    body,
    input.manifest,
  );

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group?.id ?? null,
    input.manifest,
    {
      ...buildPlanOptions(groupName, group?.backend, input),
      target: body.target as ApplyManifestOpts["target"],
    },
  );
  return c.json({
    group: {
      id: group?.id ?? null,
      name: groupName,
      exists: !!group,
    },
    ...toApiResult(result),
  });
}

async function applyGroupHandler(c: GroupsContext) {
  let group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body, c.env);
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
  return c.json(toApiResult(safeResult));
}

async function applyGroupByNameHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body, c.env);
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
    backendName: undefined,
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
    ...toApiResult(safeResult),
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
  .get(
    "/spaces/:spaceId/groups/:groupId/updates",
    spaceAccess(),
    updatesGroupHandler,
  );

export default groupsRouter;
