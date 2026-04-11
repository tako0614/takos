/**
 * Canonical group reconciler for the control plane.
 *
 * `.takos/app.yml` is compiled into `GroupDesiredState`, diffed against
 * canonical resources/services state, then reconciled through provider ops.
 */

import { eq } from "drizzle-orm";
import { groups } from "../../../infra/db/schema-groups.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import { type GroupDesiredState, materializeRoutes } from "./group-state.ts";
import type { DiffResult, GroupState } from "./diff.ts";
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
  autoApprove?: boolean;
  groupName?: string;
  envName?: string;
  dispatchNamespace?: string;
  rollbackOnFailure?: boolean;
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
        resourceId: row.providerResourceId ?? row.config.providerResourceId ??
          "",
        binding: row.config.binding,
        status: "active",
        ...((row.providerResourceName ?? row.config.providerResourceName)
          ? {
            providerResourceName: row.providerResourceName ??
              row.config.providerResourceName,
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

  const routes = desiredState
    ? materializeRoutes(desiredState.routes, workloads, group.updatedAt)
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
    provider: group.provider ?? "cloudflare",
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

  await db.update(groups)
    .set({
      appVersion: desiredState.version,
      provider: desiredState.provider,
      env: desiredState.env,
      desiredSpecJson: JSON.stringify(desiredState.manifest),
      providerStateJson: currentGroup?.providerStateJson ?? "{}",
      reconcileStatus: status,
      lastAppliedAt: now,
      updatedAt: now,
    })
    .where(eq(groups.id, groupId))
    .run();
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

  // Cross-resource deploy-time validation gate. Runs immediately before any
  // DB write or provider apply so the deploy fails fast with a clear error
  // and the caller never sees a partially-applied state.
  assertDeployValid(plan.effectiveManifest);

  let entries = plan.diff.entries;
  if (opts.target && opts.target.length > 0) {
    const targetSet = new Set(opts.target);
    entries = entries.filter((entry) => targetSet.has(entry.name));
  }

  const ordered = topologicalSortApplyEntries(entries, plan.desiredState);

  const result: ApplyResult = {
    groupId,
    applied: [],
    skipped: [],
    diff: plan.diff,
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

      if (opts.rollbackOnFailure) {
        break;
      }
    }
  }

  const refreshedState = await getGroupState(env, groupId);
  if (refreshedState) {
    const routeResults = await reconcileAppliedRoutes(
      applyEngineDeps,
      env,
      {
        desiredState: plan.desiredState,
        currentRoutes: plan.currentState?.routes ?? {},
        refreshedWorkloads: refreshedState.workloads,
        routeEntries,
        appliedAt: new Date().toISOString(),
      },
    );
    result.applied.push(...routeResults);
  }

  const hasFailures = result.applied.some((entry) => entry.status === "failed");
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
    providerName?: string;
    envName?: string;
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

  return {
    diff: plan.diff,
    translationReport: plan.translationReport,
  };
}
