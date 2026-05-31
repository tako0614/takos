import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

const scriptsRoot = fileURLToPath(
  new URL("../../../../scripts/control", import.meta.url),
);
const offloadBackfill = readFileSync(
  resolve(scriptsRoot, "offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindings = readFileSync(
  resolve(scriptsRoot, "fix-worker-bindings.js"),
  "utf8",
);
function assertSourceMatches(source: string, pattern: RegExp): void {
  assert(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}

test("DB ops script contract - requires explicit environment selection for remote backfill and worker binding inspection", () => {
  assert.ok(offloadBackfill.includes("--remote requires --env staging|production"));
  assertSourceMatches(offloadBackfill, /const D1_TARGET = ["']DB["'];/);
  assertSourceMatches(
    offloadBackfill,
    /staging:\s*["']takos-offload-staging["']/,
  );
  assertSourceMatches(offloadBackfill, /production:\s*["']takos-offload["']/);
  assert(!offloadBackfill.includes("const DB_NAME = 'takos-control-db'"));

  assert.ok(
    fixWorkerBindings.includes(
      "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
    ),
  );
  assertSourceMatches(
    fixWorkerBindings,
    /["']d1["'],\s*["']execute["'],\s*["']DB["']/,
  );
  assertSourceMatches(
    fixWorkerBindings,
    /["']--remote["'],\s*["']--env["'],\s*executionTarget\.env/,
  );
  assert.ok(
    !fixWorkerBindings.includes(
      "'wrangler', 'd1', 'execute', 'takos-control-db', '--remote'",
    ),
  );
});
