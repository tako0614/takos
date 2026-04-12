import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const denoConfig = JSON.parse(
  readFileSync(resolve(appRoot, "deno.json"), "utf8"),
) as {
  tasks?: Record<string, string>;
};
const tasks = denoConfig.tasks ?? {};
const resetDbScript = readFileSync(
  resolve(appRoot, "scripts/reset-db.js"),
  "utf8",
);
const resetDbShell = readFileSync(
  resolve(appRoot, "scripts/reset-db.sh"),
  "utf8",
);
const offloadBackfill = readFileSync(
  resolve(appRoot, "scripts/offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindings = readFileSync(
  resolve(appRoot, "scripts/fix-worker-bindings.js"),
  "utf8",
);
const createOauthClientSql = readFileSync(
  resolve(appRoot, "scripts/create-oauth-client.sql"),
  "utf8",
);
Deno.test("DB ops contract - keeps db maintenance entrypoints explicit in Deno tasks and scripts", () => {
  assertEquals(tasks["db:reset"], undefined);
  assertEquals(tasks["db:reset:local"], undefined);
  assertEquals(tasks["db:reset:staging"], undefined);
  assertEquals(tasks["db:reset:prod"], undefined);
  assertEquals(
    tasks["db:migrate"],
    "deno run -A npm:wrangler d1 migrations apply DB --local",
  );
});

Deno.test("DB ops contract - routes shell reset through the canonical JS implementation", () => {
  assertStringIncludes(resetDbShell, 'node "$SCRIPT_DIR/reset-db.js" "$@"');
});

Deno.test("DB ops contract - makes remote DB maintenance scripts require explicit environments", () => {
  assertStringIncludes(resetDbScript, "--env <staging|production>");
  assertStringIncludes(
    resetDbScript,
    "For local reset, use the local stack/bootstrap flow (`deno task local:up`); this script is for staging/production only.",
  );
  assertStringIncludes(resetDbScript, "DB");
  assert(!resetDbScript.includes("takos-control-db ${mode}"));

  assertStringIncludes(
    offloadBackfill,
    "--remote requires --env staging|production",
  );
  assertStringIncludes(offloadBackfill, "const D1_TARGET = 'DB'");
  assertStringIncludes(offloadBackfill, "staging: 'takos-offload-staging'");
  assertStringIncludes(offloadBackfill, "production: 'takos-offload'");

  assertStringIncludes(
    fixWorkerBindings,
    "Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]",
  );
  assertStringIncludes(fixWorkerBindings, "'d1', 'execute', 'DB'");
  assertStringIncludes(
    fixWorkerBindings,
    "'--remote', '--env', executionTarget.env",
  );
});

Deno.test("DB ops contract - keeps helper OAuth seed data aligned with the current public scope contract", () => {
  assertStringIncludes(createOauthClientSql, "spaces:read");
  assert(!createOauthClientSql.includes("workspaces:read"));
});
