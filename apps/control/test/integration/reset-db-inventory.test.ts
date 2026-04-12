import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const baselineSql = readFileSync(
  resolve(appRoot, "db/migrations/0001_baseline.sql"),
  "utf8",
);
const resetDbScript = readFileSync(
  resolve(appRoot, "scripts/reset-db.js"),
  "utf8",
);
const resetDbShellScript = readFileSync(
  resolve(appRoot, "scripts/reset-db.sh"),
  "utf8",
);
const offloadBackfillScript = readFileSync(
  resolve(appRoot, "scripts/offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindingsScript = readFileSync(
  resolve(appRoot, "scripts/fix-worker-bindings.js"),
  "utf8",
);
const createOauthClientSql = readFileSync(
  resolve(appRoot, "scripts/create-oauth-client.sql"),
  "utf8",
);
const dropAllSql = readFileSync(resolve(appRoot, "drop_all.sql"), "utf8");
const denoConfig = JSON.parse(
  readFileSync(resolve(appRoot, "deno.json"), "utf8"),
) as {
  tasks?: Record<string, string>;
};
const tasks = denoConfig.tasks ?? {};

function parseBaselineTables(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]),
    ),
  ].sort();
}

function parseQuotedArray(source: string, constName: string): string[] {
  const match = source.match(
    new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\n\\];`),
  );
  if (!match) {
    throw new Error(`Could not find ${constName}`);
  }

  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((arrayMatch) =>
    arrayMatch[1]
  );
}

function parseDropTables(source: string): string[] {
  return [...source.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+);/g)].map((
    match,
  ) => match[1]);
}
Deno.test("reset DB inventory - keeps reset-db.js aligned with the canonical baseline SQL table inventory", () => {
  const baselineTables = parseBaselineTables(baselineSql);
  const resetTables = parseQuotedArray(resetDbScript, "TABLES");

  assert(/const ACCOUNT_TABLE = ["']accounts["'];/.test(resetDbScript));
  assert(!resetTables.includes("accounts"));
  assertEquals(resetTables.length, new Set(resetTables).size);

  const fullInventory = [...resetTables, "accounts"].sort();
  assertEquals(fullInventory, baselineTables);
});

Deno.test("reset DB inventory - preserves only accounts by default", () => {
  assertStringIncludes(
    resetDbScript,
    "This will DELETE all data except accounts rows.",
  );
  assert(!resetDbScript.includes("users"));
  assert(!resetDbScript.includes("principals"));
});

Deno.test("reset DB inventory - keeps remote reset script-driven instead of hiding it behind shorthand tasks", () => {
  assertEquals(tasks["db:reset"], undefined);
  assertEquals(tasks["db:reset:local"], undefined);
  assertEquals(tasks["db:reset:staging"], undefined);
  assertEquals(tasks["db:reset:prod"], undefined);
  assertEquals(
    tasks["db:migrate"],
    "deno run -A npm:wrangler d1 migrations apply DB --local",
  );

  assertStringIncludes(
    resetDbScript,
    "Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]",
  );
  assertStringIncludes(
    resetDbScript,
    "For local reset, use the local stack/bootstrap flow (`deno task local:up`); this script is for staging/production only.",
  );
  assertStringIncludes(
    resetDbShellScript,
    'node "$SCRIPT_DIR/reset-db.js" "$@"',
  );
});

Deno.test("reset DB inventory - requires explicit remote environment selection for maintenance helpers", () => {
  assertStringIncludes(
    offloadBackfillScript,
    "--remote requires --env staging|production",
  );
  assertStringIncludes(offloadBackfillScript, "const D1_TARGET = 'DB';");
  assert(!offloadBackfillScript.includes("takos-control-db"));
  assertStringIncludes(fixWorkerBindingsScript, "--env staging|production");
  assertStringIncludes(fixWorkerBindingsScript, "'DB'");
  assert(!fixWorkerBindingsScript.includes("takos-control-db"));
});

Deno.test("reset DB inventory - keeps OAuth seed SQL aligned with the canonical scope contract", () => {
  assertStringIncludes(createOauthClientSql, "spaces:read");
  assert(!createOauthClientSql.includes("workspaces:read"));
});

Deno.test("reset DB inventory - keeps drop_all.sql aligned with the canonical baseline SQL table inventory", () => {
  const baselineTables = parseBaselineTables(baselineSql);
  const dropTables = parseDropTables(dropAllSql);

  assertEquals(dropTables.length, new Set(dropTables).size);
  assert(dropTables.includes("d1_migrations"));

  const dropTablesWithoutMigrations = dropTables
    .filter((table) => table !== "d1_migrations")
    .sort();
  assertEquals(dropTablesWithoutMigrations, baselineTables);
});
