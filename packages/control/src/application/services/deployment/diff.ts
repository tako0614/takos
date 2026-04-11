/**
 * Diff computation for the canonical group reconciler.
 *
 * Desired state is compiled from `.takos/app.yml` into `GroupDesiredState`.
 * Current state is reconstructed from canonical tables (`groups`, `resources`,
 * `services`) plus the group's observed routing snapshot.
 *
 * Resource reconciliation was retired from the app deploy substrate. The
 * current-state resource snapshot is still carried for observability and
 * legacy internal APIs, but app-manifest diffs intentionally ignore it.
 */

import type { GroupDesiredState, ObservedGroupState } from "./group-state.ts";

export type DiffAction = "create" | "update" | "delete" | "unchanged";

export type EntityCategory =
  | "resource"
  | "worker"
  | "container"
  | "service"
  | "route";

export interface DiffEntry {
  name: string;
  category: EntityCategory;
  action: DiffAction;
  type?: string;
  reason?: string;
}

export interface DiffResult {
  entries: DiffEntry[];
  hasChanges: boolean;
  summary: {
    create: number;
    update: number;
    delete: number;
    unchanged: number;
  };
}

export type GroupState = ObservedGroupState;

function computeRouteShape(route: {
  target: string;
  path?: string;
  methods?: string[];
  ingress?: string;
  timeoutMs?: number;
}): string {
  return JSON.stringify({
    target: route.target,
    path: route.path ?? null,
    methods: route.methods ?? null,
    ingress: route.ingress ?? null,
    timeoutMs: route.timeoutMs ?? null,
  });
}

export function computeDiff(
  desired: GroupDesiredState,
  current: GroupState | null,
): DiffResult {
  const entries: DiffEntry[] = [];

  const desiredWorkloads = desired.workloads;
  const currentWorkloads = current?.workloads ?? {};

  for (const [name, workload] of Object.entries(desiredWorkloads)) {
    const existing = currentWorkloads[name];
    if (!existing) {
      entries.push({
        name,
        category: workload.category,
        action: "create",
        type: workload.category,
        reason: "new",
      });
      continue;
    }
    if (existing.category !== workload.category) {
      entries.push({
        name,
        category: workload.category,
        action: "update",
        type: workload.category,
        reason: "component kind changed",
      });
      continue;
    }
    if ((existing.specFingerprint ?? "") !== workload.specFingerprint) {
      entries.push({
        name,
        category: workload.category,
        action: "update",
        type: workload.category,
        reason: "spec changed",
      });
    } else {
      entries.push({
        name,
        category: workload.category,
        action: "unchanged",
        type: workload.category,
      });
    }
  }

  for (const [name, workload] of Object.entries(currentWorkloads)) {
    if (!desiredWorkloads[name]) {
      entries.push({
        name,
        category: workload.category,
        action: "delete",
        type: workload.category,
        reason: "removed from manifest",
      });
    }
  }

  const desiredRoutes = desired.routes;
  const currentRoutes = current?.routes ?? {};

  for (const [name, route] of Object.entries(desiredRoutes)) {
    const existing = currentRoutes[name];
    if (!existing) {
      entries.push({
        name,
        category: "route",
        action: "create",
        type: "route",
        reason: "new",
      });
      continue;
    }
    if (computeRouteShape(existing) !== computeRouteShape(route)) {
      entries.push({
        name,
        category: "route",
        action: "update",
        type: "route",
        reason: "route changed",
      });
    } else {
      entries.push({
        name,
        category: "route",
        action: "unchanged",
        type: "route",
      });
    }
  }

  for (const name of Object.keys(currentRoutes)) {
    if (!desiredRoutes[name]) {
      entries.push({
        name,
        category: "route",
        action: "delete",
        type: "route",
        reason: "removed from manifest",
      });
    }
  }

  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of entries) {
    summary[entry.action]++;
  }

  return {
    entries,
    hasChanges: summary.create > 0 || summary.update > 0 || summary.delete > 0,
    summary,
  };
}

export function computeWorkerDiff(
  workerName: string,
  newCodeHash: string,
  current: GroupState | null,
): DiffEntry {
  const existing = current?.workloads?.[workerName];
  if (!existing) {
    return {
      name: workerName,
      category: "worker",
      action: "create",
      type: "worker",
      reason: "new",
    };
  }
  if (existing.category !== "worker") {
    return {
      name: workerName,
      category: "worker",
      action: "update",
      type: "worker",
      reason: "component kind changed",
    };
  }
  if ((existing.codeHash ?? "") !== newCodeHash) {
    return {
      name: workerName,
      category: "worker",
      action: "update",
      type: "worker",
      reason: "code changed",
    };
  }
  return {
    name: workerName,
    category: "worker",
    action: "unchanged",
    type: "worker",
  };
}
