import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

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
test("DB ops contract - keeps db maintenance entrypoints explicit in Bun scripts and control scripts", () => {
  assert.deepStrictEqual(scripts["db:reset"], undefined);
  assert.deepStrictEqual(scripts["db:reset:local"], undefined);
  assert.deepStrictEqual(scripts["db:reset:staging"], undefined);
  assert.deepStrictEqual(scripts["db:reset:prod"], undefined);
  assert.deepStrictEqual(
    scripts["db:migrate"],
    undefined,
  );
  assert.deepStrictEqual(
    scripts["validate:migration-safety"],
    "bun scripts/validate-migration-safety.ts",
  );
});

test("DB ops contract - routes shell reset through the canonical JS implementation", () => {
  assert.ok(resetDbShell.includes('node "$SCRIPT_DIR/reset-db.js" "$@"'));
});

test("DB ops contract - makes remote DB maintenance scripts require explicit environments", () => {
  assert.ok(resetDbScript.includes("--env <staging|production>"));
  assert.ok(
    resetDbScript.includes(
      "For local reset, use the local stack/bootstrap flow (`bun run local:up`); this script is for staging/production only.",
    ),
  );
  assert.ok(resetDbScript.includes("DB"));
  assert.ok(!resetDbScript.includes("takos-control-db ${mode}"));

  assert.ok(
    offloadBackfill.includes("--remote requires --env staging|production"),
  );
  assertSourceMatches(offloadBackfill, /const D1_TARGET = ["']DB["'];?/);
  assertSourceMatches(
    offloadBackfill,
    /staging:\s*["']takos-offload-staging["']/,
  );
  assertSourceMatches(offloadBackfill, /production:\s*["']takos-offload["']/);

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
});
