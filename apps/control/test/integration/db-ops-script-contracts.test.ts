import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertStringIncludes } from "jsr:@std/assert";

const scriptsRoot = fileURLToPath(new URL("../../scripts", import.meta.url));
const offloadBackfill = readFileSync(
  resolve(scriptsRoot, "offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindings = readFileSync(
  resolve(scriptsRoot, "fix-worker-bindings.js"),
  "utf8",
);
const createOAuthClientSql = readFileSync(
  resolve(scriptsRoot, "create-oauth-client.sql"),
  "utf8",
);

function assertSourceMatches(source: string, pattern: RegExp): void {
  assert(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}

Deno.test("DB ops script contract - requires explicit environment selection for remote backfill and worker binding inspection", () => {
  assertStringIncludes(
    offloadBackfill,
    "--remote requires --env staging|production",
  );
  assertSourceMatches(offloadBackfill, /const D1_TARGET = ["']DB["'];/);
  assertSourceMatches(
    offloadBackfill,
    /staging:\s*["']takos-offload-staging["']/,
  );
  assertSourceMatches(offloadBackfill, /production:\s*["']takos-offload["']/);
  assert(!offloadBackfill.includes("const DB_NAME = 'takos-control-db'"));

  assertStringIncludes(
    fixWorkerBindings,
    "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
  );
  assertSourceMatches(
    fixWorkerBindings,
    /["']d1["'],\s*["']execute["'],\s*["']DB["']/,
  );
  assertSourceMatches(
    fixWorkerBindings,
    /["']--remote["'],\s*["']--env["'],\s*executionTarget\.env/,
  );
  assert(
    !fixWorkerBindings.includes(
      "'wrangler', 'd1', 'execute', 'takos-control-db', '--remote'",
    ),
  );
});

Deno.test("DB ops script contract - keeps helper SQL aligned with the current spaces OAuth scope contract", () => {
  assertStringIncludes(createOAuthClientSql, "spaces:read");
  assert(!createOAuthClientSql.includes("workspaces:read"));
});
