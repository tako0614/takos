import type { DiffEntry } from "./diff.ts";
import type { GroupDesiredState } from "./group-state.ts";

const CATEGORY_PRIORITY: Record<string, number> = {
  container: 0,
  worker: 1,
  service: 2,
  route: 3,
};

export function topologicalSortApplyEntries(
  entries: DiffEntry[],
  desiredState: GroupDesiredState,
): DiffEntry[] {
  const dependsOnMap = new Map<string, string[]>();
  for (const [name, workload] of Object.entries(desiredState.workloads)) {
    if (workload.dependsOn.length > 0) {
      dependsOnMap.set(name, workload.dependsOn);
    }
  }

  const deletes = entries.filter((entry) => entry.action === "delete");
  const nonDeletes = entries.filter((entry) => entry.action !== "delete");
  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();
  return [...sortedNonDeletes, ...sortedDeletes];
}

function topoSortDFS(
  entries: DiffEntry[],
  dependsOnMap: Map<string, string[]>,
): DiffEntry[] {
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const visited = new Set<string>();
  const result: DiffEntry[] = [];

  const sorted = [...entries].sort(
    (a, b) =>
      (CATEGORY_PRIORITY[a.category] ?? 99) -
      (CATEGORY_PRIORITY[b.category] ?? 99),
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
