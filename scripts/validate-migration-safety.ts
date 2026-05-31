#!/usr/bin/env -S deno run --config deno.json --allow-read

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const migrationsDir = "db/migrations-control/migrations";
const safetyDocPath = join(migrationsDir, "MIGRATION_SAFETY.md");
const firstGuardedPrefix = 63;
const allowedClasses = new Set(["expand", "backfill", "contract", "emergency"]);

const dangerousPatterns: Array<
  { readonly name: string; readonly pattern: RegExp }
> = [
  { name: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  {
    name: "ALTER TABLE RENAME TO",
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/i,
  },
  {
    name: "ALTER TABLE RENAME COLUMN",
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+COLUMN\b/i,
  },
  {
    name: "ALTER COLUMN SET NOT NULL",
    pattern:
      /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i,
  },
  {
    name: "CREATE UNIQUE INDEX without IF NOT EXISTS",
    pattern: /\bCREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/i,
  },
];

const failures: string[] = [];

await validateSafetyDoc();

const entries = (await readdir(migrationsDir))
  .filter((entry) => entry.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b));

for (const fileName of entries) {
  await validateMigration(fileName);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  Deno.exit(1);
}

console.log(`Validated migration safety for ${entries.length} migration(s)`);

async function validateSafetyDoc(): Promise<void> {
  try {
    await stat(safetyDocPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      failures.push(`missing ${safetyDocPath}`);
      return;
    }
    throw error;
  }

  const doc = await readFile(safetyDocPath, "utf8");
  for (
    const expected of [
      "The first guarded migration prefix is `0063`.",
      "-- takos-migration-safety: expand",
      "-- takos-migration-approval:",
      "-- takos-migration-rollback:",
      "Takos app migrations are forward-only",
    ]
  ) {
    if (!doc.includes(expected)) {
      failures.push(`${safetyDocPath}: expected to mention ${expected}`);
    }
  }
}

async function validateMigration(fileName: string): Promise<void> {
  const prefix = Number(fileName.match(/^(\d{4})_/)?.[1]);
  if (!Number.isInteger(prefix)) {
    failures.push(
      `${fileName}: migration filename must start with a four-digit prefix`,
    );
    return;
  }
  if (prefix < firstGuardedPrefix) return;

  const sql = await readFile(join(migrationsDir, fileName), "utf8");
  const safetyClass = parseSafetyClass(sql);
  if (!safetyClass) {
    failures.push(`${fileName}: missing -- takos-migration-safety marker`);
    return;
  }
  if (!allowedClasses.has(safetyClass)) {
    failures.push(
      `${fileName}: unsupported migration safety class '${safetyClass}'`,
    );
    return;
  }

  const dangerous = dangerousPatterns
    .filter(({ pattern }) => pattern.test(sql))
    .map(({ name }) => name);
  if (dangerous.length === 0) return;

  if (safetyClass !== "contract" && safetyClass !== "emergency") {
    failures.push(
      `${fileName}: ${safetyClass} migration contains dangerous DDL: ${
        dangerous.join(", ")
      }`,
    );
  }
  if (!/--\s*takos-migration-approval:\s*\S+/i.test(sql)) {
    failures.push(
      `${fileName}: dangerous DDL requires -- takos-migration-approval`,
    );
  }
  if (!/--\s*takos-migration-rollback:\s*\S+/i.test(sql)) {
    failures.push(
      `${fileName}: dangerous DDL requires -- takos-migration-rollback`,
    );
  }
}

function parseSafetyClass(sql: string): string | undefined {
  return sql.match(/--\s*takos-migration-safety:\s*([a-z-]+)/i)?.[1];
}
