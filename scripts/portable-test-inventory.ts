import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PORTABLE_TEST_EXCLUSIONS_PATH =
  "security/portable-test-exclusions.json";
export const PORTABLE_TEST_EXCLUSIONS_KIND =
  "takos.portable-test-exclusions@v1" as const;

/**
 * Inputs that affect the dependency graph, compiler, build configuration, or
 * test inventory. A focused changed-test run cannot safely model these edits,
 * so the owner gate falls back to the complete portable set.
 */
const completePortableInputPatterns: readonly RegExp[] = [
  /^(?:package\.json|bun\.lock)$/u,
  /(^|\/)[^/]+\.config\.[^/]+$/u,
  /(^|\/)[^/]+\.jsonc$/u,
  /(^|\/)(?:[^/]+\.(?:ya?ml|toml)|Dockerfile(?:\..*)?)$/u,
  /^(?:tsconfig(?:\.[^/]+)?|jsconfig(?:\.[^/]+)?)\.json$/u,
  /^scripts\/(?:build-web|portable-test-inventory|run-portable-tests)\.[^/]+$/u,
  /^security\/(?:portable-test-exclusions|dependency-audit-waivers)\.json$/u,
  /(^|\/)(?:generated|__generated__)\//u,
  /(^|\/)[^/]*(?:\.generated|schema-bundle)\.[^/]+$/u,
];

const portableTestPattern =
  /(?:^|\/)[^/]+(?:\.test|\.spec)\.(?:[cm]?[jt]sx?)$|(?:^|\/)[^/]+_test\.(?:[cm]?[jt]sx?)$/u;

export type PortableTestExclusion = {
  path: string;
  capability: string;
  reason: string;
  owningCadence: string;
};

export type PortableTestExclusionManifest = {
  kind: typeof PORTABLE_TEST_EXCLUSIONS_KIND;
  maxEntries: number;
  exclusions: PortableTestExclusion[];
};

export type PortableTestInventory = {
  tracked: string[];
  excluded: string[];
  selected: string[];
  duplicates: string[];
  missing: string[];
};

/**
 * Return all repository-owned Bun test files in deterministic order.
 *
 * Git's cached and non-ignored untracked set is the source of truth. This keeps
 * a newly-added test in the complete gate before it is staged while still
 * excluding ignored dependency/build fixtures.
 */
export function discoverTrackedPortableTests(repoRoot: string): string[] {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `unable to discover tracked tests: ${result.stderr.toString().trim()}`,
    );
  }

  return result
    .stdout.toString()
    .split("\0")
    .filter((path) => path.length > 0 && isPortableTestPath(path))
    .sort((left, right) => left.localeCompare(right));
}

export function isPortableTestPath(path: string): boolean {
  return (
    portableTestPattern.test(path) &&
    !path.split("/").some((segment) =>
      ["node_modules", "dist", "coverage", "target"].includes(segment),
    )
  );
}

export function requiresCompletePortableTests(
  changedPaths: readonly string[],
): boolean {
  return changedPaths.some((path) =>
    completePortableInputPatterns.some((pattern) => pattern.test(path)),
  );
}

/**
 * Collect changed source names from the index, worktree, and non-ignored
 * untracked files. Staged-only global changes must trigger the same complete
 * fallback as their unstaged equivalents.
 */
export function discoverChangedInputs(
  repoRoot: string,
  ref?: string,
): string[] {
  const gitNames = (args: string[]): string[] => {
    const result = Bun.spawnSync({
      cmd: ["git", ...args],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `unable to inspect changed inputs: ${result.stderr.toString().trim()}`,
      );
    }
    return result.stdout
      .toString()
      .split("\0")
      .filter(Boolean);
  };

  const committed = gitNames([
    "diff",
    "--name-only",
    "-z",
    ...(ref ? [ref] : []),
    "--",
  ]);
  const staged = gitNames(["diff", "--cached", "--name-only", "-z", "--"]);
  const untracked = gitNames([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
  ]);
  return [...new Set([...committed, ...staged, ...untracked])].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function loadPortableTestExclusions(
  repoRoot: string,
): PortableTestExclusionManifest {
  const path = resolve(repoRoot, PORTABLE_TEST_EXCLUSIONS_PATH);
  if (!existsSync(path)) {
    throw new Error(`portable test exclusion manifest is missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as PortableTestExclusionManifest;
}

export function validatePortableTestExclusions(
  manifest: PortableTestExclusionManifest,
  repoRoot: string,
): string[] {
  const errors: string[] = [];
  if (manifest.kind !== PORTABLE_TEST_EXCLUSIONS_KIND) {
    errors.push("portable test exclusion manifest kind is unsupported");
  }
  if (!Number.isInteger(manifest.maxEntries) || manifest.maxEntries < 1) {
    errors.push("portable test exclusion maxEntries must be a positive integer");
  }
  if (!Array.isArray(manifest.exclusions)) {
    return [...errors, "portable test exclusions must be an array"];
  }
  if (
    Number.isInteger(manifest.maxEntries) &&
    manifest.exclusions.length > manifest.maxEntries
  ) {
    errors.push(
      `portable test exclusions exceed the small allowlist limit (${manifest.exclusions.length} > ${manifest.maxEntries})`,
    );
  }

  const tracked = discoverTrackedPortableTests(repoRoot);
  const seen = new Set<string>();
  for (const [index, exclusion] of manifest.exclusions.entries()) {
    const prefix = `portable test exclusion ${index + 1}`;
    if (!exclusion || typeof exclusion !== "object") {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const path = typeof exclusion.path === "string" ? exclusion.path : "";
    const capability =
      typeof exclusion.capability === "string" ? exclusion.capability : "";
    const reason = typeof exclusion.reason === "string" ? exclusion.reason : "";
    const owningCadence =
      typeof exclusion.owningCadence === "string"
        ? exclusion.owningCadence
        : "";

    if (path.trim().length === 0) errors.push(`${prefix} path is required`);
    if (capability.trim().length === 0)
      errors.push(`${prefix} capability is required`);
    if (reason.trim().length === 0) errors.push(`${prefix} reason is required`);
    if (owningCadence.trim().length === 0) {
      errors.push(`${prefix} owningCadence is required`);
    }
    if (path.length > 0 && seen.has(path)) {
      errors.push(`${prefix} duplicates exclusion path ${path}`);
    }
    if (path.length > 0) seen.add(path);

    if (path.length > 0 && !isPortableTestPath(path)) {
      errors.push(`${prefix} path is not a portable test file: ${path}`);
    } else if (path.length > 0 && !tracked.includes(path)) {
      errors.push(`${prefix} path does not exist as a tracked portable test: ${path}`);
    }
  }

  return errors;
}

export function buildPortableTestInventory(
  repoRoot: string,
  manifest: PortableTestExclusionManifest,
): PortableTestInventory {
  const tracked = discoverTrackedPortableTests(repoRoot);
  const excluded = manifest.exclusions
    .map((exclusion) => exclusion.path)
    .filter((path) => tracked.includes(path));
  const excludedSet = new Set(excluded);
  const selected = tracked.filter((path) => !excludedSet.has(path));

  const duplicateExclusions = excluded.filter(
    (path, index) => excluded.indexOf(path) !== index,
  );
  const duplicates = [...new Set(duplicateExclusions)].sort((left, right) =>
    left.localeCompare(right),
  );
  const missing = tracked.filter(
    (path) =>
      !excludedSet.has(path) &&
      (!selected.includes(path) || !existsSync(resolve(repoRoot, path))),
  );

  return { tracked, excluded, selected, duplicates, missing };
}

export function formatPortableTestInventory(
  inventory: PortableTestInventory,
): string {
  return JSON.stringify(
    {
      tracked: inventory.tracked.length,
      excluded: inventory.excluded,
      selected: inventory.selected.length,
      duplicates: inventory.duplicates,
      missing: inventory.missing,
    },
    null,
    2,
  );
}
