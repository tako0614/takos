/**
 * Canonical group reconciler for the control plane.
 *
 * `.takos/app.yml` is compiled into `GroupDesiredState`, diffed against
 * canonical resources/services state, then reconciled through backend ops.
 */

import { eq, inArray } from "drizzle-orm";
import { BadRequestError } from "takos-common/errors";
import { groups } from "../../../infra/db/schema-groups.ts";
import { deployments } from "../../../infra/db/schema-workers.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import {
  assertManifestPublicationPrerequisites,
  listPublications,
} from "../platform/service-publications.ts";
import { getGroupAutoHostname } from "../routing/group-hostnames.ts";
import {
  type GroupDesiredState,
  materializeRoutes,
  type ObservedGroupState,
} from "./group-state.ts";
import {
  diffEntryMatchesTarget,
  type DiffEntry,
  type DiffResult,
  filterDiffByTargets,
  type GroupState,
  validateTargetsAgainstDesiredState,
} from "./diff.ts";
import { topologicalSortApplyEntries } from "./apply-order.ts";
import type { TranslationReport } from "./translation-report.ts";
import type { Env } from "../../../shared/types/env.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { buildManifestPlan } from "./apply-engine-plan.ts";
import { assertDeployValid } from "./deploy-validation.ts";
import {
  applyEngineDeps,
  type GroupRow,
  loadDesiredManifest,
  loadDesiredState,
} from "./apply-engine-shared.ts";
import {
  executeApplyEntry,
  prepareWorkloadApplyEntries,
  reconcileAppliedRoutes,
  syncGroupDesiredStateForWorkloads,
} from "./apply-engine-executor.ts";
import { parseApplyArtifact } from "./apply-engine-artifacts.ts";

export { applyEngineDeps };

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: "success" | "failed";
  error?: string;
}

export interface ApplyResult {
  groupId: string;
  applied: ApplyEntryResult[];
  skipped: string[];
  diff: DiffResult;
  translationReport: TranslationReport;
}

export type SafeApplyResult = ApplyResult;

export interface PlanResult {
  diff: DiffResult;
  translationReport: TranslationReport;
}

export interface ApplyManifestOpts {
  target?: string[];
  groupName?: string;
  envName?: string;
  artifacts?: Record<string, unknown>;
}

function summarizeDiffEntries(entries: DiffEntry[]): DiffResult["summary"] {
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of entries) summary[entry.action]++;
  return summary;
}

export async function applyArtifactChangesToDiff(
  diff: DiffResult,
  currentState: GroupState | null,
  artifacts?: Record<string, unknown>,
): Promise<DiffResult> {
  if (!artifacts) return diff;

  let changed = false;
  const entries = await Promise.all(diff.entries.map(async (entry) => {
    if (entry.category !== "worker" || entry.action !== "unchanged") {
      return entry;
    }

    const artifact = parseApplyArtifact(artifacts[entry.name]);
    if (artifact?.kind !== "worker_bundle") return entry;

    const nextHash = await computeSHA256(artifact.bundleContent);
    const currentHash = currentState?.workloads?.[entry.name]?.codeHash ?? "";
    if (currentHash === nextHash) return entry;

    changed = true;
    return {
      ...entry,
      action: "update" as const,
      reason: "code changed",
    };
  }));

  if (!changed) return diff;
  const summary = summarizeDiffEntries(entries);
  return {
    entries,
    hasChanges: summary.create > 0 || summary.update > 0 ||
      summary.delete > 0,
    summary,
  };
}

async function getGroupRecord(
  env: Env,
  groupId: string,
): Promise<GroupRow | null> {
  const db = applyEngineDeps.getDb(env.DB);
  return db.select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .get() as Promise<GroupRow | null>;
}

export async function getGroupState(
  env: Env,
  groupId: string,
): Promise<GroupState | null> {
  const group = await getGroupRecord(env, groupId);
  if (!group) return null;

  const resourceRows = await applyEngineDeps.listResources(env, groupId);
  const serviceRows = await applyEngineDeps.listGroupManagedServices(
    env,
    groupId,
  );
  const desiredState = loadDesiredState(group);
  const activeDeploymentIds = serviceRows
    .map((record) => record.row.activeDeploymentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const activeDeploymentArtifactRefs = new Map<string, string>();
  if (activeDeploymentIds.length > 0) {
    const rows = await applyEngineDeps.getDb(env.DB).select({
      id: deployments.id,
      artifactRef: deployments.artifactRef,
    })
      .from(deployments)
      .where(inArray(deployments.id, activeDeploymentIds))
      .all();
    for (const row of rows) {
      if (row.artifactRef) {
        activeDeploymentArtifactRefs.set(row.id, row.artifactRef);
      }
    }
  }

  const resources = Object.fromEntries(
    resourceRows.map((row) => [
      row.name,
      {
        name: row.name,
        type: row.config.type,
        resourceId: row.backingResourceId ?? row.config.backingResourceId ??
          "",
        binding: row.config.binding,
        status: "active",
        ...((row.backingResourceName ?? row.config.backingResourceName)
          ? {
            backingResourceName: row.backingResourceName ??
              row.config.backingResourceName,
          }
          : {}),
        ...(row.config.specFingerprint
          ? { specFingerprint: row.config.specFingerprint }
          : {}),
        updatedAt: row.updatedAt,
      },
    ]),
  );

  const workloads = Object.fromEntries(
    serviceRows
      .filter((record) =>
        record.config.componentKind && record.config.manifestName
      )
      .map((record) => [
        record.config.manifestName as string,
        {
          serviceId: record.row.id,
          name: record.config.manifestName as string,
          category: record.config.componentKind as
            | "worker"
            | "container"
            | "service",
          status: record.row.status,
          ...(record.row.hostname ? { hostname: record.row.hostname } : {}),
          ...(record.row.routeRef ? { routeRef: record.row.routeRef } : {}),
          ...(record.row.activeDeploymentId
            ? { activeDeploymentId: record.row.activeDeploymentId }
            : {}),
          ...(record.row.activeDeploymentId &&
              activeDeploymentArtifactRefs.has(record.row.activeDeploymentId)
            ? {
              activeArtifactRef: activeDeploymentArtifactRefs.get(
                record.row.activeDeploymentId,
              )!,
            }
            : {}),
          ...(record.row.workloadKind
            ? { workloadKind: record.row.workloadKind }
            : {}),
          ...(record.config.specFingerprint
            ? { specFingerprint: record.config.specFingerprint }
            : {}),
          ...(record.config.deployedAt
            ? { deployedAt: record.config.deployedAt }
            : {}),
          ...(record.config.codeHash
            ? { codeHash: record.config.codeHash }
            : {}),
          ...(record.config.imageHash
            ? { imageHash: record.config.imageHash }
            : {}),
          ...(record.config.imageRef
            ? { imageRef: record.config.imageRef }
            : {}),
          ...(typeof record.config.port === "number"
            ? { port: record.config.port }
            : {}),
          ...(record.config.ipv4 ? { ipv4: record.config.ipv4 } : {}),
          ...(record.config.dispatchNamespace
            ? { dispatchNamespace: record.config.dispatchNamespace }
            : {}),
          ...(record.config.resolvedBaseUrl
            ? { resolvedBaseUrl: record.config.resolvedBaseUrl }
            : {}),
          updatedAt: record.row.updatedAt,
        },
      ]),
  );

  const groupHostname = desiredState
    ? await getGroupAutoHostname(env, {
      groupId,
      spaceId: group.spaceId,
    })
    : null;
  const routes = desiredState
    ? materializeRoutes(desiredState.routes, workloads, group.updatedAt, {
      groupHostname,
    })
    : {};

  if (
    Object.keys(resources).length === 0 &&
    Object.keys(workloads).length === 0 && Object.keys(routes).length === 0
  ) {
    return null;
  }

  return {
    groupId,
    groupName: group.name,
    backend: group.backend ?? "cloudflare",
    env: group.env ?? "default",
    version: group.appVersion,
    updatedAt: group.updatedAt,
    resources,
    workloads,
    routes,
  };
}

async function saveGroupSnapshots(
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  currentGroup: GroupRow | null,
  status: "ready" | "degraded",
): Promise<void> {
  const db = applyEngineDeps.getDb(env.DB);
  const now = new Date().toISOString();
  const snapshot = buildGroupSnapshotUpdate(
    desiredState,
    currentGroup,
    status,
  );

  await db.update(groups)
    .set({
      ...snapshot,
      lastAppliedAt: status === "ready"
        ? now
        : currentGroup?.lastAppliedAt ?? null,
      updatedAt: now,
    })
    .where(eq(groups.id, groupId))
    .run();
}

export function buildGroupSnapshotUpdate(
  desiredState: GroupDesiredState,
  currentGroup: GroupRow | null,
  status: "ready" | "degraded",
): {
  appVersion: string | null;
  backend: string | null;
  env: string | null;
  desiredSpecJson: string | null;
  backendStateJson: string;
  reconcileStatus: "ready" | "degraded";
} {
  if (status === "ready") {
    return {
      appVersion: desiredState.version,
      backend: desiredState.backend,
      env: desiredState.env,
      desiredSpecJson: JSON.stringify(desiredState.manifest),
      backendStateJson: currentGroup?.backendStateJson ?? "{}",
      reconcileStatus: status,
    };
  }

  return {
    appVersion: currentGroup?.appVersion ?? null,
    backend: currentGroup?.backend ?? null,
    env: currentGroup?.env ?? null,
    desiredSpecJson: currentGroup?.desiredSpecJson ?? null,
    backendStateJson: currentGroup?.backendStateJson ?? "{}",
    reconcileStatus: status,
  };
}

export function resolveTargetWorkloadNames(
  desiredState: GroupDesiredState,
  targets?: string[],
): string[] | undefined {
  const normalizedTargets = (targets ?? []).map((target) => target.trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) return undefined;

  const names = new Set<string>();
  for (const workload of Object.values(desiredState.workloads)) {
    if (
      normalizedTargets.some((target) =>
        diffEntryMatchesTarget(
          {
            name: workload.name,
            category: workload.category,
            action: "unchanged",
          },
          target,
        )
      )
    ) {
      names.add(workload.name);
    }
  }
  return Array.from(names.values());
}

export function buildPublicationPrerequisiteManifest(
  desiredState: GroupDesiredState,
  targetWorkloadNames?: string[],
): AppManifest {
  if (targetWorkloadNames === undefined) {
    return desiredState.manifest;
  }
  const targeted = new Set(targetWorkloadNames);
  return {
    ...desiredState.manifest,
    compute: Object.fromEntries(
      Object.entries(desiredState.manifest.compute ?? {}).filter(([name]) =>
        targeted.has(name)
      ),
    ),
    publish: (desiredState.manifest.publish ?? []).filter((publication) =>
      targeted.has(publication.publisher)
    ),
  };
}

export function manifestNeedsEarlyPublicationSync(
  manifest: Pick<AppManifest, "compute" | "publish">,
): boolean {
  const publicationNames = new Set(
    (manifest.publish ?? []).map((publication) => publication.name),
  );
  if (publicationNames.size === 0) return false;
  return Object.values(manifest.compute ?? {}).some((compute) =>
    (compute.consume ?? []).some((consume) =>
      publicationNames.has(consume.publication)
    )
  );
}

export async function applyManifest(
  env: Env,
  groupId: string,
  manifest?: AppManifest,
  opts: ApplyManifestOpts = {},
): Promise<ApplyResult> {
  const group = await getGroupRecord(env, groupId);
  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const plan = await buildManifestPlan(applyEngineDeps, {
    env,
    groupId,
    group,
    manifest,
    opts: {
      groupName: opts.groupName,
      envName: opts.envName,
    },
    loadDesiredManifest,
    getCurrentState: (targetGroupId) => getGroupState(env, targetGroupId),
  });
  const requestedTargets = (opts.target ?? []).map((target) => target.trim())
    .filter(Boolean);

  const unmatchedTargets = validateTargetsAgainstDesiredState(
    plan.desiredState,
    opts.target,
  );
  if (unmatchedTargets.length > 0) {
    throw new BadRequestError(
      `Target${unmatchedTargets.length > 1 ? "s" : ""} ${
        unmatchedTargets.map((target) => `'${target}'`).join(", ")
      } did not match any desired workload or route`,
    );
  }

  if (requestedTargets.length > 0) {
    if (Object.keys(plan.desiredState.resources).length > 0) {
      throw new BadRequestError(
        "Partial deploys cannot synchronize manifest resources. Deploy without target scoping, or remove resources{} entries before using targeted applies.",
      );
    }
    const publicationRows = await listPublications(env, group.spaceId);
    const hasExistingManifestPublications = publicationRows.some((row) =>
      row.groupId === groupId && row.sourceType === "manifest"
    );
    const hasDesiredPublications =
      (plan.desiredState.manifest.publish?.length ?? 0) > 0;
    if (hasExistingManifestPublications || hasDesiredPublications) {
      throw new BadRequestError(
        "Partial deploys cannot synchronize manifest publications. Deploy without target scoping, or remove publish[] entries before using targeted applies.",
      );
    }
  }

  // Cross-resource deploy-time validation gates. They run immediately before
  // runtime apply so deploy fails fast with a clear error instead of reaching
  // managed-state sync after workloads have been applied.
  assertDeployValid(plan.effectiveManifest);
  const targetWorkloadNames = resolveTargetWorkloadNames(
    plan.desiredState,
    opts.target,
  );
  const scopedPublicationManifest = buildPublicationPrerequisiteManifest(
    plan.desiredState,
    targetWorkloadNames,
  );
  await assertManifestPublicationPrerequisites(env, {
    spaceId: group.spaceId,
    groupId,
    manifest: scopedPublicationManifest,
  });
  applyEngineDeps.assertTranslationSupported(plan.translationReport, {
    ...applyEngineDeps.buildTranslationContextFromEnv(env),
  });

  const artifactAwareDiff = await applyArtifactChangesToDiff(
    plan.diff,
    plan.currentState,
    opts.artifacts,
  );
  const diff = filterDiffByTargets(artifactAwareDiff, opts.target);
  const entries = diff.entries;

  const ordered = topologicalSortApplyEntries(entries, plan.desiredState);

  const result: ApplyResult = {
    groupId,
    applied: [],
    skipped: [],
    diff,
    translationReport: plan.translationReport,
  };
  const routeEntries = ordered.filter((entry) =>
    entry.category === "route" && entry.action !== "unchanged"
  );
  let refreshedState: Awaited<ReturnType<typeof getGroupState>> = null;
  const envName = opts.envName ?? group.env ?? "default";
  const needsEarlyPublicationSync = manifestNeedsEarlyPublicationSync(
    scopedPublicationManifest,
  );

  const prepareFailures = await prepareWorkloadApplyEntries(
    applyEngineDeps,
    env,
    {
      entries: ordered,
      desiredState: plan.desiredState,
      groupId,
      group,
      envName,
    },
  );
  result.applied.push(...prepareFailures);
  let hasFailures = prepareFailures.length > 0;

  if (!hasFailures && needsEarlyPublicationSync) {
    const publicationState = await getGroupState(env, groupId) ??
      refreshedState ?? plan.currentState ??
      {
        groupId,
        groupName: group.name,
        backend: group.backend ?? "cloudflare",
        env: group.env ?? "default",
        version: plan.desiredState.version,
        updatedAt: group.updatedAt,
        resources: {},
        workloads: {},
        routes: {},
      } as ObservedGroupState;
    const publicationResults = await applyEngineDeps
      .syncGroupPublicationDesiredState(
        env,
        {
          spaceId: group.spaceId,
          desiredState: plan.desiredState,
          observedState: publicationState,
        },
      );
    result.applied.push(
      ...publicationResults.map((failure) => ({
        name: failure.name,
        category: "managed-state",
        action: "update",
        status: "failed" as const,
        error: failure.error,
      })),
    );
    hasFailures = result.applied.some((entry) => entry.status === "failed");
  }

  for (const entry of ordered) {
    if (hasFailures) break;
    if (entry.action === "unchanged") {
      result.skipped.push(entry.name);
      continue;
    }
    if (entry.category === "route") {
      continue;
    }

    try {
      await executeApplyEntry(applyEngineDeps, getGroupState, env, {
        entry,
        desiredState: plan.desiredState,
        groupId,
        group,
        opts,
      });
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: "success",
      });
    } catch (error) {
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });

      break;
    }
  }

  hasFailures = result.applied.some((entry) => entry.status === "failed");
  if (!hasFailures) {
    const publicationState = await getGroupState(env, groupId) ??
      refreshedState ?? plan.currentState ??
      {
        groupId,
        groupName: group.name,
        backend: group.backend ?? "cloudflare",
        env: group.env ?? "default",
        version: plan.desiredState.version,
        updatedAt: group.updatedAt,
        resources: {},
        workloads: {},
        routes: {},
      } as ObservedGroupState;
    const publicationResults = await applyEngineDeps
      .syncGroupPublicationDesiredState(
        env,
        {
          spaceId: group.spaceId,
          desiredState: plan.desiredState,
          observedState: publicationState,
        },
      );
    result.applied.push(
      ...publicationResults.map((failure) => ({
        name: failure.name,
        category: "managed-state",
        action: "update",
        status: "failed" as const,
        error: failure.error,
      })),
    );
    hasFailures = result.applied.some((entry) => entry.status === "failed");
  }

  if (!hasFailures) {
    const syncFailures = await syncGroupDesiredStateForWorkloads(
      applyEngineDeps,
      getGroupState,
      env,
      groupId,
      plan.desiredState,
      group.spaceId,
      {
        targetWorkloadNames,
      },
    );
    result.applied.push(
      ...syncFailures.map((failure) => ({
        name: failure.name,
        category: "managed-state",
        action: "update",
        status: "failed" as const,
        error: failure.error,
      })),
    );
    hasFailures = result.applied.some((entry) => entry.status === "failed");
  }

  const shouldReconcileRoutes = !hasFailures;
  if (shouldReconcileRoutes) {
    refreshedState = await getGroupState(env, groupId);
    if (refreshedState) {
      const routeResults = await reconcileAppliedRoutes(
        applyEngineDeps,
        env,
        {
          groupId,
          spaceId: group.spaceId,
          desiredState: plan.desiredState,
          currentRoutes: plan.currentState?.routes ?? {},
          refreshedWorkloads: refreshedState.workloads,
          routeEntries,
          appliedAt: new Date().toISOString(),
        },
      );
      result.applied.push(...routeResults);
      hasFailures = result.applied.some((entry) => entry.status === "failed");
    }
  }

  await saveGroupSnapshots(
    env,
    groupId,
    plan.desiredState,
    group,
    hasFailures ? "degraded" : "ready",
  );

  return result;
}

export function buildSafeApplyResult(result: ApplyResult): SafeApplyResult {
  return result;
}

export async function planManifest(
  env: Env,
  groupId: string | null,
  manifest?: AppManifest,
  opts: {
    groupName?: string;
    backendName?: string;
    envName?: string;
    target?: string[];
  } = {},
): Promise<PlanResult> {
  const group = groupId ? await getGroupRecord(env, groupId) : null;
  if (groupId && !group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const plan = await buildManifestPlan(applyEngineDeps, {
    env,
    groupId,
    group,
    manifest,
    opts,
    loadDesiredManifest,
    getCurrentState: (targetGroupId) => getGroupState(env, targetGroupId),
  });
  assertDeployValid(plan.effectiveManifest);
  if (group) {
    const targetWorkloadNames = resolveTargetWorkloadNames(
      plan.desiredState,
      opts.target,
    );
    const scopedPublicationManifest = buildPublicationPrerequisiteManifest(
      plan.desiredState,
      targetWorkloadNames,
    );
    await assertManifestPublicationPrerequisites(env, {
      spaceId: group.spaceId,
      groupId: group.id,
      manifest: scopedPublicationManifest,
    });
  }

  return {
    diff: filterDiffByTargets(plan.diff, opts.target),
    translationReport: plan.translationReport,
  };
}
