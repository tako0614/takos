import { test } from "bun:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExternalRuntimeServiceRegistry } from "../dispatch-resolver.ts";

const workerRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function resolveRelativeImport(
  importer: string,
  specifier: string,
): Promise<string | null> {
  const base = path.resolve(path.dirname(importer), specifier);
  for (
    const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]
  ) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next TypeScript source candidate.
    }
  }
  return null;
}

function relativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImport =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

async function collectRelativeImportGraph(entry: string): Promise<Set<string>> {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    for (const specifier of relativeSpecifiers(source)) {
      const resolved = await resolveRelativeImport(current, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return visited;
}

test("Node dispatch does not reach the product-local deployment runtime", async () => {
  const graph = await collectRelativeImportGraph(
    path.join(workerRoot, "node-platform/env-builder.ts"),
  );
  const relativeGraph = new Set(
    Array.from(graph, (file) => path.relative(workerRoot, file)),
  );

  for (
    const forbidden of [
      "local-platform/tenant-worker-runtime.ts",
      "local-platform/miniflare-registry.ts",
      "local-platform/miniflare-bindings.ts",
      "application/services/deployment/service.ts",
      "runtime/queues/deploy-jobs.ts",
    ]
  ) {
    equal(relativeGraph.has(forbidden), false, `${forbidden} is reachable`);
  }
});

test("Node dispatch fails closed when no external runtime target is configured", async () => {
  const registry = createExternalRuntimeServiceRegistry({});
  const response = await registry.get("capsule-worker").fetch(
    new Request("https://tenant.example.test/"),
  );

  equal(response.status, 503);
  deepStrictEqual(await response.json(), {
    error: "Local service target not configured",
    worker: "capsule-worker",
  });
});
