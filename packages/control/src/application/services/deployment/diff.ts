/**
 * Diff computation for the canonical group reconciler.
 *
 * Desired state is compiled from `.takos/app.yml` into `GroupDesiredState`.
 * Current state is reconstructed from canonical tables (`groups`, `resources`,
 * `services`) plus the group's observed routing snapshot.
 *
 * Resource reconciliation is part of the manifest deploy pipeline for
 * manifest-owned resources. The current-state snapshot is reconstructed from
 * canonical resource rows and compared with `manifest.resources`.
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

function summarizeEntries(entries: DiffEntry[]): DiffResult["summary"] {
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of entries) {
    summary[entry.action]++;
  }
  return summary;
}

function pluralCategory(category: EntityCategory): string {
  return `${category}s`;
}

export function diffEntryMatchesTarget(
  entry: DiffEntry,
  target: string,
): boolean {
  const normalized = target.trim();
  if (!normalized) return false;
  if (normalized === entry.name) return true;
  return normalized === `${entry.category}.${entry.name}` ||
    normalized === `${pluralCategory(entry.category)}.${entry.name}`;
}

function desiredEntryMatchesTarget(
  desired: { name: string; category: EntityCategory },
  target: string,
): boolean {
  return diffEntryMatchesTarget(
    {
      name: desired.name,
      category: desired.category,
      action: "unchanged",
    },
    target,
  );
}

export function validateTargetsAgainstDesiredState(
  desired: Pick<GroupDesiredState, "resources" | "workloads" | "routes">,
  targets?: string[],
): string[] {
  const normalizedTargets = (targets ?? []).map((target) => target.trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) return [];

  const unmatched: string[] = [];
  for (const target of normalizedTargets) {
    const resourceMatch = Object.values(desired.resources).some((resource) =>
      desiredEntryMatchesTarget(
        { name: resource.name, category: "resource" },
        target,
      )
    );
    const workloadMatch = Object.values(desired.workloads).some((workload) =>
      desiredEntryMatchesTarget(
        { name: workload.name, category: workload.category },
        target,
      )
    );
    const routeMatch = Object.values(desired.routes).some((route) =>
      desiredEntryMatchesTarget({ name: route.name, category: "route" }, target)
    );
    if (!resourceMatch && !workloadMatch && !routeMatch) {
      unmatched.push(target);
    }
  }
  return unmatched;
}

export function filterDiffByTargets(
  diff: DiffResult,
  targets?: string[],
): DiffResult {
  const normalizedTargets = (targets ?? []).map((target) => target.trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) return diff;

  const entries = diff.entries.filter((entry) =>
    normalizedTargets.some((target) => diffEntryMatchesTarget(entry, target))
  );
  const summary = summarizeEntries(entries);
  return {
    entries,
    hasChanges: summary.create > 0 || summary.update > 0 ||
      summary.delete > 0,
    summary,
  };
}

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

function isRetryableWorkloadStatus(status: string): boolean {
  return status === "pending" || status === "failed";
}

export function computeDiff(
  desired: GroupDesiredState,
  current: GroupState | null,
): DiffResult {
  const entries: DiffEntry[] = [];

  const desiredResources = desired.resources;
  const currentResources = current?.resources ?? {};

  for (const [name, resource] of Object.entries(desiredResources)) {
    const existing = currentResources[name];
    if (!existing) {
      entries.push({
        name,
        category: "resource",
        action: "create",
        type: resource.spec.type,
        reason: "new",
      });
      continue;
    }
    if (existing.type !== resource.spec.type) {
      entries.push({
        name,
        category: "resource",
        action: "update",
        type: resource.spec.type,
        reason: "resource type changed",
      });
      continue;
    }
    if ((existing.specFingerprint ?? "") !== resource.specFingerprint) {
      entries.push({
        name,
        category: "resource",
        action: "update",
        type: resource.spec.type,
        reason: "spec changed",
      });
    } else {
      entries.push({
        name,
        category: "resource",
        action: "unchanged",
        type: resource.spec.type,
      });
    }
  }

  for (const [name, resource] of Object.entries(currentResources)) {
    if (!desiredResources[name]) {
      entries.push({
        name,
        category: "resource",
        action: "delete",
        type: resource.type,
        reason: "removed from manifest",
      });
    }
  }

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
    } else if (isRetryableWorkloadStatus(existing.status)) {
      entries.push({
        name,
        category: workload.category,
        action: "update",
        type: workload.category,
        reason: `workload status ${existing.status}`,
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

  const summary = summarizeEntries(entries);

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
