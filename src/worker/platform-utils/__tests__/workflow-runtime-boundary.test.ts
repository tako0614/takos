import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const workerRoot = path.resolve(import.meta.dir, "../..");
const entrypoint = path.join(workerRoot, "index.ts");

const forbiddenRuntimeModules = [
  "/application/services/actions/actions-triggers.ts",
  "/application/services/workflow-runs/commands.ts",
  "/application/services/execution/workflow-run-lifecycle.ts",
  "/runtime/queues/workflow-runner.ts",
  "/runtime/queues/workflow-job-handler.ts",
];

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

async function collectReachableModules(root: string): Promise<Set<string>> {
  const reachable = new Set<string>();
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);

    const source = await readFile(current, "utf8");
    for (const match of source.matchAll(moduleSpecifierPattern)) {
      const resolved = await resolveRelativeModule(current, match[1]);
      if (resolved && resolved.startsWith(workerRoot)) pending.push(resolved);
    }
  }

  return reachable;
}

test("Takos Worker entrypoint cannot reach the retired local Actions materializer", async () => {
  const reachable = await collectReachableModules(entrypoint);
  const relativeModules = [...reachable].map(
    (file) => `/${path.relative(workerRoot, file).replaceAll(path.sep, "/")}`,
  );

  for (const forbidden of forbiddenRuntimeModules) {
    expect(
      relativeModules,
      `${forbidden} is reachable from src/worker/index.ts`,
    ).not.toContain(forbidden);
  }
});
