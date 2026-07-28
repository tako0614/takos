import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workerRoot = path.resolve(import.meta.dir, "../../..");
const workerEntrypoint = path.join(workerRoot, "index.ts");

const retiredHostingPrefixes = [
  "/actions-engine/",
  "/application/services/actions/",
  "/application/services/pull-requests/",
  "/application/services/workflow-runs/",
  "/server/routes/pull-requests/",
  "/server/routes/repos/",
  "/server/routes/sessions/",
] as const;

const retiredHostingModules = [
  "/application/services/source/fork.ts",
  "/application/services/source/repos.ts",
  "/application/services/sync/git-sync.ts",
] as const;

const moduleSpecifierPattern =
  /(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g;

async function resolveRelativeModule(
  importer: string,
  specifier: string,
): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;

  const rawPath = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(rawPath)
    ? [rawPath]
    : [`${rawPath}.ts`, path.join(rawPath, "index.ts")];

  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

async function collectReachableWorkerModules(): Promise<string[]> {
  const reachable = new Set<string>();
  const pending = [workerEntrypoint];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);

    const source = await readFile(current, "utf8");
    for (const match of source.matchAll(moduleSpecifierPattern)) {
      const resolved = await resolveRelativeModule(current, match[1]);
      if (resolved?.startsWith(workerRoot)) pending.push(resolved);
    }
  }

  return [...reachable].map(
    (file) => `/${path.relative(workerRoot, file).replaceAll(path.sep, "/")}`,
  );
}

test("Takos Worker cannot reach retired collaborative Git hosting modules", async () => {
  const reachable = await collectReachableWorkerModules();

  for (const prefix of retiredHostingPrefixes) {
    expect(
      reachable.some((module) => module.startsWith(prefix)),
      `${prefix} is reachable from src/worker/index.ts`,
    ).toBeFalse();
  }

  for (const module of retiredHostingModules) {
    expect(
      reachable,
      `${module} is reachable from src/worker/index.ts`,
    ).not.toContain(module);
  }
});
