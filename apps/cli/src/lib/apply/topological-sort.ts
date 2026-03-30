/**
 * Topological sort — DFS-based ordering for diff entries.
 *
 * Respects explicit `dependsOn` declarations and falls back to a
 * default category priority for unrelated nodes.
 */

import type { DiffEntry } from '../state/diff.js';
import type { AppManifest } from '../app-manifest.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default priority by category (lower = earlier in create order). */
export const CATEGORY_PRIORITY: Record<string, number> = {
  resource: 0,
  container: 1,
  worker: 2,
  service: 3,
  route: 4,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function topologicalSort(entries: DiffEntry[], manifest: AppManifest): DiffEntry[] {
  // Build an adjacency list from dependsOn declarations across all categories.
  const dependsOnMap = buildDependsOnMap(manifest.spec);

  // Partition into deletes vs non-deletes; deletes are processed in reverse order.
  const deletes = entries.filter((e) => e.action === 'delete');
  const nonDeletes = entries.filter((e) => e.action !== 'delete');

  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();

  return [...sortedNonDeletes, ...sortedDeletes];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Collect dependsOn edges from workers, containers, services definitions. */
export function buildDependsOnMap(
  spec: AppManifest['spec'],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const allDefs: Record<string, { dependsOn?: string[] }>[] = [
    spec.workers ?? {},
    spec.containers ?? {},
    spec.services ?? {},
  ];

  for (const defs of allDefs) {
    for (const [name, def] of Object.entries(defs)) {
      if (Array.isArray(def.dependsOn)) {
        map.set(name, def.dependsOn);
      }
    }
  }

  return map;
}

/** DFS topological sort.  Falls back to category priority for unrelated nodes. */
export function topoSortDFS(
  entries: DiffEntry[],
  dependsOnMap: Map<string, string[]>,
): DiffEntry[] {
  const entryByName = new Map(entries.map((e) => [e.name, e]));
  const visited = new Set<string>();
  const result: DiffEntry[] = [];

  // Sort by category priority first so that unrelated nodes come out in
  // a predictable order (resource -> container -> worker -> service).
  const sorted = [...entries].sort(
    (a, b) => (CATEGORY_PRIORITY[a.category] ?? 99) - (CATEGORY_PRIORITY[b.category] ?? 99),
  );

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const deps = dependsOnMap.get(name) ?? [];
    for (const dep of deps) {
      if (entryByName.has(dep)) {
        visit(dep);
      }
    }

    const entry = entryByName.get(name);
    if (entry) {
      result.push(entry);
    }
  }

  for (const entry of sorted) {
    visit(entry.name);
  }

  return result;
}
