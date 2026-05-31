import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const appRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const packageConfig = JSON.parse(
  readFileSync(resolve(appRoot, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};
const scripts = packageConfig.scripts ?? {};
const resetDbScript = readFileSync(
  resolve(appRoot, "scripts/control/reset-db.js"),
  "utf8",
);
const resetDbShell = readFileSync(
  resolve(appRoot, "scripts/control/reset-db.sh"),
  "utf8",
);
const offloadBackfill = readFileSync(
  resolve(appRoot, "scripts/control/offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindings = readFileSync(
  resolve(appRoot, "scripts/control/fix-worker-bindings.js"),
  "utf8",
);

function assertSourceMatches(source: string, pattern: RegExp): void {
  assert(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}
Deno.test("DB ops contract - keeps db maintenance entrypoints explicit in Bun scripts and control scripts", () => {
  assertEquals(scripts["db:reset"], undefined);
  assertEquals(scripts["db:reset:local"], undefined);
  assertEquals(scripts["db:reset:staging"], undefined);
  assertEquals(scripts["db:reset:prod"], undefined);
  assertEquals(
    scripts["db:migrate"],
    undefined,
  );
  assertEquals(
    scripts["validate:migration-safety"],
    "bun --preload ./shims/deno-compat.ts scripts/validate-migration-safety.ts",
  );
});

Deno.test("DB ops contract - routes shell reset through the canonical JS implementation", () => {
  assertStringIncludes(resetDbShell, 'node "$SCRIPT_DIR/reset-db.js" "$@"');
});

Deno.test("DB ops contract - makes remote DB maintenance scripts require explicit environments", () => {
  assertStringIncludes(resetDbScript, "--env <staging|production>");
  assertStringIncludes(
    resetDbScript,
    "For local reset, use the local stack/bootstrap flow (`bun run local:up`); this script is for staging/production only.",
  );
  assertStringIncludes(resetDbScript, "DB");
  assert(!resetDbScript.includes("takos-control-db ${mode}"));

  assertStringIncludes(
    offloadBackfill,
    "--remote requires --env staging|production",
  );
  assertSourceMatches(offloadBackfill, /const D1_TARGET = ["']DB["'];?/);
  assertSourceMatches(
    offloadBackfill,
    /staging:\s*["']takos-offload-staging["']/,
  );
  assertSourceMatches(offloadBackfill, /production:\s*["']takos-offload["']/);

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
});
