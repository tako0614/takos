import type { Context } from "hono";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { SpaceAccessRouteEnv } from "../route-auth.ts";
import {
  appTokens,
  deployments,
  groups,
  resources,
  services,
} from "../../../infra/db/index.ts";
import {
  type ApplyManifestOpts,
  buildSafeApplyResult,
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
import { parseAppManifestText } from "../../../application/services/source/app-manifest-parser/index.ts";
import type { AppManifest } from "../../../application/services/source/app-manifest-types.ts";
import { getUpdateType } from "../../../application/services/deployment/store-install.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import { groupRecordDeps, groupsRouteDeps } from "./deps.ts";

export type GroupsContext = Context<SpaceAccessRouteEnv>;
export type GroupRouteBody = Record<string, unknown>;
export type GroupMetadataOverrides = {
  providerProvided: boolean;
  provider: GroupProviderName | null;
  envProvided: boolean;
  envName: string | null;
};
export type ParsedGroupDeployRequest = GroupMetadataOverrides & {
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

export function parseGroupProvider(raw: unknown): GroupProviderName | null {
  if (raw === undefined || raw === null) return null;
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

export function parseGroupEnv(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new BadRequestError(`Invalid env: ${String(raw)}`);
  }
  const normalized = raw.trim();
  if (!normalized) {
    throw new BadRequestError("env must be a non-empty string");
  }
  return normalized;
}

export function requireNonEmptyString(raw: unknown, field: string): string {
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

function getGroupIdParam(c: GroupsContext): string {
  const groupId = c.req.param("groupId");
  if (!groupId) throw new BadRequestError("groupId param is required");
  return groupId;
}

function hasOwn(body: GroupRouteBody, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  return safeJsonParseOrDefault<T | null>(value, null);
}

export function toApiGroup(group: {
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

export function parseDesiredManifestInput(raw: unknown): AppManifest {
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

export function parseGroupMetadataOverrides(
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

export function parseGroupDeployRequest(
  body: GroupRouteBody,
): ParsedGroupDeployRequest {
  return {
    ...parseGroupMetadataOverrides(body),
    manifest: parseRequestManifest(body.manifest),
    source: parseGroupSourceProjection(body.source),
  };
}

export function resolveGroupName(
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

export function buildUninstallManifest(group: GroupRow): AppManifest {
  return {
    name: group.name,
    ...(group.appVersion ? { version: group.appVersion } : {}),
    compute: {},
    routes: [],
    publish: [],
    env: {},
  };
}

export async function assertGroupNameAvailable(
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

export async function requireGroupInSpace(c: GroupsContext): Promise<GroupRow> {
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

export async function requireGroupByNameInSpace(
  env: Env,
  spaceId: string,
  groupName: string,
): Promise<GroupRow> {
  const group = await findGroupInSpaceByName(env, spaceId, groupName);
  if (!group) throw new NotFoundError("Group");
  return group;
}

export async function applyGroupMetadataOverrides(
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

export async function updatePersistedGroupMetadata(
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

  return requireGroupInSpace(c);
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

export async function resolveNamedManifestGroup(
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

export function buildPlanOptions(
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

export async function applyManifestForGroup(
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

export async function revokeGroupTokensAndDelete(
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

export async function assertGroupDeletable(
  env: Env,
  groupId: string,
): Promise<void> {
  const db = groupsRouteDeps.getDb(env.DB);
  const ownedResources = await db.select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.groupId, groupId), ne(resources.status, "deleted")))
    .all();
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, groupId))
    .all();

  if (ownedResources.length > 0 || ownedServices.length > 0) {
    throw new BadRequestError(
      "Group still owns resources or services. Apply an empty manifest before deleting the group.",
    );
  }
}

export async function listActiveGroupResources(
  env: Env,
  groupId: string,
) {
  const db = groupsRouteDeps.getDb(env.DB);
  return db.select()
    .from(resources)
    .where(and(eq(resources.groupId, groupId), ne(resources.status, "deleted")))
    .all();
}

export async function listGroupServices(
  env: Env,
  groupId: string,
) {
  const db = groupsRouteDeps.getDb(env.DB);
  return db.select()
    .from(services)
    .where(eq(services.groupId, groupId))
    .all();
}

export async function listGroupDeployments(
  env: Env,
  groupId: string,
) {
  const db = groupsRouteDeps.getDb(env.DB);
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, groupId))
    .all();
  const serviceIds = ownedServices.map((service) => service.id);

  if (serviceIds.length === 0) {
    return [];
  }

  return db.select()
    .from(deployments)
    .where(inArray(deployments.serviceId, serviceIds))
    .all();
}

export async function listSpaceGroups(
  env: Env,
  spaceId: string,
) {
  const db = groupsRouteDeps.getDb(env.DB);
  return db.select().from(groups).where(eq(groups.spaceId, spaceId));
}

export async function createOrReuseGroupForApply(
  c: GroupsContext,
  body: GroupRouteBody,
  input: ParsedGroupDeployRequest,
): Promise<{ finalGroup: GroupRow }> {
  const { space } = c.get("access");
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

  return { finalGroup };
}

export async function resolveGroupForUninstall(
  c: GroupsContext,
  body: GroupRouteBody,
): Promise<GroupRow> {
  const { space } = c.get("access");
  const groupName = resolveGroupName(body.group_name);
  return requireGroupByNameInSpace(c.env, space.id, groupName);
}

export function buildUpdatesResponse(
  group: Pick<GroupRow, "appVersion">,
  latest: string | null | undefined,
) {
  if (!latest || !group.appVersion) {
    return {
      available: false,
      currentVersion: group.appVersion,
      latestVersion: latest ?? null,
    };
  }

  return {
    available: group.appVersion !== latest,
    currentVersion: group.appVersion,
    latestVersion: latest,
    updateType: getUpdateType(group.appVersion, latest),
  };
}

export function assertUninstallCompleted(
  safeResult: ReturnType<typeof buildSafeApplyResult>,
  observed:
    | {
      resources?: Record<string, unknown>;
      workloads?: Record<string, unknown>;
      routes?: Record<string, unknown>;
    }
    | null
    | undefined,
): void {
  if (hasFailedApplyEntries(safeResult)) {
    throw new ConflictError(
      "Uninstall failed. Managed resources were not fully removed.",
    );
  }

  if (countObservedInventory(observed) > 0) {
    throw new ConflictError(
      "Uninstall did not fully drain group-managed inventory",
    );
  }
}
