/**
 * Canonical group reconciler for the control plane.
 *
 * `.takos/app.yml` is compiled into `GroupDesiredState`, diffed against
 * canonical resources/services state, then reconciled through backend ops.
 */

import { eq } from "drizzle-orm";
import { BadRequestError } from "takos-common/errors";
import { groups } from "../../../infra/db/schema-groups.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import { assertManifestPublicationPrerequisites } from "../platform/service-publications.ts";
import { getGroupAutoHostname } from "../routing/group-hostnames.ts";
import { type GroupDesiredState, materializeRoutes } from "./group-state.ts";
import {
  type DiffResult,
  filterDiffByTargets,
  type GroupState,
  validateTargetsAgainstDesiredState,
} from "./diff.ts";
import { topologicalSortApplyEntries } from "./apply-order.ts";
import type { TranslationReport } from "./translation-report.ts";
import type { Env } from "../../../shared/types/env.ts";
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
  reconcileAppliedRoutes,
  syncGroupDesiredStateForWorkloads,
} from "./apply-engine-executor.ts";

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

function resolveTargetWorkloadNames(
  diff: DiffResult,
  targets?: string[],
): string[] | undefined {
  const normalizedTargets = (targets ?? []).map((target) => target.trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) return undefined;

  const names = new Set(
    diff.entries
      .filter((entry) => entry.category !== "route")
      .map((entry) => entry.name),
  );
  return names.size > 0 ? Array.from(names.values()) : [];
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

  // Cross-resource deploy-time validation gates. They run immediately before
  // runtime apply so deploy fails fast with a clear error instead of reaching
  // managed-state sync after workloads have been applied.
  assertDeployValid(plan.effectiveManifest);
  await assertManifestPublicationPrerequisites(env, {
    spaceId: group.spaceId,
    manifest: plan.effectiveManifest,
  });
  applyEngineDeps.assertTranslationSupported(plan.translationReport, {
    ...applyEngineDeps.buildTranslationContextFromEnv(env),
  });

  const diff = filterDiffByTargets(plan.diff, opts.target);
  const targetWorkloadNames = resolveTargetWorkloadNames(diff, opts.target);
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

  for (const entry of ordered) {
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

  let hasFailures = result.applied.some((entry) => entry.status === "failed");
  const shouldSyncManagedState = !hasFailures;
  if (shouldSyncManagedState) {
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
    const refreshedState = await getGroupState(env, groupId);
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
    await assertManifestPublicationPrerequisites(env, {
      spaceId: group.spaceId,
      manifest: plan.effectiveManifest,
    });
  }

  return {
    diff: filterDiffByTargets(plan.diff, opts.target),
    translationReport: plan.translationReport,
  };
}
