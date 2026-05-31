import type {
  BranchFilter,
  Workflow,
  WorkflowTrigger,
} from "takos-actions-engine";

export function getTriggerConfig<K extends keyof WorkflowTrigger>(
  workflow: Workflow,
  eventName: K,
): WorkflowTrigger[K] | null | undefined {
  const on = workflow.on;
  if (typeof on === "string") return on === eventName ? null : undefined;
  if (Array.isArray(on)) return on.includes(eventName) ? null : undefined;
  if (!on || typeof on !== "object") return undefined;
  if (!(eventName in on)) return undefined;
  const trigger = on[eventName];
  if (!trigger || typeof trigger !== "object") return null;
  return trigger;
}

export function matchesBranchAndPathFilters(
  config: BranchFilter,
  branch: string,
  changedFiles?: string[],
): boolean {
  if (
    !matchesBranchFilters(branch, config.branches, config["branches-ignore"])
  ) return false;
  if (!matchesPathFilters(changedFiles, config.paths, config["paths-ignore"])) {
    return false;
  }
  return true;
}

export function matchesBranchFilters(
  branch: string,
  branches?: string[],
  branchesIgnore?: string[],
): boolean {
  if (
    Array.isArray(branches) && branches.length > 0 &&
    !matchesAnyPattern(branch, branches)
  ) return false;
  if (
    Array.isArray(branchesIgnore) && branchesIgnore.length > 0 &&
    matchesAnyPattern(branch, branchesIgnore)
  ) return false;
  return true;
}

export function matchesPathFilters(
  changedFiles: string[] | undefined,
  paths?: string[],
  pathsIgnore?: string[],
): boolean {
  if (!changedFiles || changedFiles.length === 0) {
    return !(Array.isArray(paths) && paths.length > 0) &&
      !(Array.isArray(pathsIgnore) && pathsIgnore.length > 0);
  }
  if (
    Array.isArray(paths) && paths.length > 0 &&
    !changedFiles.some((file) => matchesAnyPattern(file, paths))
  ) return false;
  if (
    Array.isArray(pathsIgnore) && pathsIgnore.length > 0 &&
    changedFiles.every((file) => matchesAnyPattern(file, pathsIgnore))
  ) return false;
  return true;
}

export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

const GLOB_CACHE_MAX_ENTRIES = 2048;
const globCache = new Map<string, RegExp>();
export function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(
    /\*\*/g,
    "___DOUBLE_STAR___",
  ).replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(
    /___DOUBLE_STAR___/g,
    ".*",
  );
  const regex = new RegExp(`^${escaped}$`);
  if (globCache.size >= GLOB_CACHE_MAX_ENTRIES) {
    globCache.clear();
  }
  globCache.set(glob, regex);
  return regex;
}

/** @internal Test-only: inspect / clear the glob cache. */
export const __globCacheInternals = {
  size: () => globCache.size,
  clear: () => globCache.clear(),
  maxEntries: GLOB_CACHE_MAX_ENTRIES,
};

export function uniqueRefs(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string =>
        Boolean(value)
      ),
    ),
  );
}
