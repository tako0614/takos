/**
 * 3-way tree merge — path-level OID/mode comparison.
 *
 * Adapted from git-store/merge.ts for native git format.
 */

import type { R2Bucket } from "../../../../shared/types/bindings.ts";
import type { MergeConflict, MergeConflictType } from "../git-objects.ts";
import { buildTreeFromPaths, flattenTree } from "./tree-ops.ts";

interface TreeFileEntry {
  sha: string;
  mode: string;
}

function entriesEqual(
  a: TreeFileEntry | null,
  b: TreeFileEntry | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.sha === b.sha && a.mode === b.mode;
}

function classifyConflict(
  base: TreeFileEntry | null,
  local: TreeFileEntry | null,
  upstream: TreeFileEntry | null,
): MergeConflictType {
  if (base === null && local !== null && upstream !== null) return "add-add";

  const localDeleted = base !== null && local === null;
  const upstreamDeleted = base !== null && upstream === null;
  if (
    (localDeleted && upstream !== null) || (upstreamDeleted && local !== null)
  ) return "delete-modify";

  return "content";
}

export async function mergeTrees3Way(
  bucket: R2Bucket,
  baseTreeSha: string,
  localTreeSha: string,
  upstreamTreeSha: string,
): Promise<{ tree_sha: string | null; conflicts: MergeConflict[] }> {
  const [baseFiles, localFiles, upstreamFiles] = await Promise.all([
    flattenTree(bucket, baseTreeSha),
    flattenTree(bucket, localTreeSha),
    flattenTree(bucket, upstreamTreeSha),
  ]);

  const toMap = (
    files: Array<{ path: string; sha: string; mode: string }>,
  ): Map<string, TreeFileEntry> =>
    new Map(files.map((f) => [f.path, { sha: f.sha, mode: f.mode }]));

  const baseMap = toMap(baseFiles);
  const localMap = toMap(localFiles);
  const upstreamMap = toMap(upstreamFiles);

  const mergedMap = new Map<string, TreeFileEntry>();
  const conflicts: MergeConflict[] = [];

  const allPaths = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...upstreamMap.keys(),
  ]);

  for (const path of allPaths) {
    const baseEntry = baseMap.get(path) || null;
    const localEntry = localMap.get(path) || null;
    const upstreamEntry = upstreamMap.get(path) || null;

    const localChanged = !entriesEqual(baseEntry, localEntry);
    const upstreamChanged = !entriesEqual(baseEntry, upstreamEntry);

    if (!localChanged && !upstreamChanged) {
      if (baseEntry) mergedMap.set(path, baseEntry);
      continue;
    }

    if (localChanged && !upstreamChanged) {
      if (localEntry) mergedMap.set(path, localEntry);
      continue;
    }

    if (!localChanged && upstreamChanged) {
      if (upstreamEntry) mergedMap.set(path, upstreamEntry);
      continue;
    }

    if (entriesEqual(localEntry, upstreamEntry)) {
      if (localEntry) mergedMap.set(path, localEntry);
      continue;
    }

    conflicts.push({
      path,
      type: classifyConflict(baseEntry, localEntry, upstreamEntry),
    });
  }

  if (conflicts.length > 0) {
    conflicts.sort((a, b) => a.path.localeCompare(b.path));
    return { tree_sha: null, conflicts };
  }

  const mergedFiles = Array.from(mergedMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, entry]) => ({ path, sha: entry.sha, mode: entry.mode }));

  const tree_sha = await buildTreeFromPaths(bucket, mergedFiles);
  return { tree_sha, conflicts: [] };
}
