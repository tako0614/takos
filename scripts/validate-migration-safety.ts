#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const migrationsDir = "db/migrations-control/migrations";
const safetyDocPath = join(migrationsDir, "MIGRATION_SAFETY.md");
const ORDERING_PATH = join(migrationsDir, "ORDERING.json");

type Ordering = {
  readonly note: string;
  /** Prefix -> why two migrations already share it. */
  readonly duplicatePrefixes: Readonly<Record<string, string>>;
  /** Prefix -> why the sequence already skips it. */
  readonly skippedPrefixes: Readonly<Record<string, string>>;
};

const ordering = JSON.parse(
  await readFile(ORDERING_PATH, "utf8"),
) as Ordering;
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

validateOrdering(entries);

for (const fileName of entries) {
  await validateMigration(fileName);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  runtime.exit(1);
}

console.log(`Validated migration safety for ${entries.length} migration(s)`);

async function validateSafetyDoc(): Promise<void> {
  try {
    await stat(safetyDocPath);
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) {
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

/**
 * The applied set is keyed by migration file name, so a name is an identity a
 * live database already holds. Renaming one re-applies it. The ordering rules
 * are therefore forward-looking: two files may not share a prefix, and the
 * sequence may not skip a number, unless the situation already exists and is
 * declared with its reason in `ORDERING.json`.
 *
 * The comparator is also pinned here. Every applier — this gate,
 * `generate-runtime-migration-set.ts`, and the Worker's runtime applier —
 * orders by file name, and for four-digit zero-padded prefixes that is the
 * same order as ordering by number. A file whose prefix is not four digits
 * would break that equivalence silently, so it is refused.
 */
function validateOrdering(names: readonly string[]): void {
  const byPrefix = new Map<string, string[]>();
  for (const name of names) {
    const prefix = name.match(/^(\d{4})_/u)?.[1];
    if (prefix === undefined) {
      failures.push(
        `${name}: migration filename must start with a four-digit prefix`,
      );
      continue;
    }
    const bucket = byPrefix.get(prefix);
    if (bucket) bucket.push(name);
    else byPrefix.set(prefix, [name]);
  }

  for (const [prefix, sharing] of [...byPrefix].sort()) {
    if (sharing.length < 2) continue;
    if (ordering.duplicatePrefixes[prefix] === undefined) {
      failures.push(
        `prefix ${prefix} is used by ${sharing.join(", ")}; two migrations may not share a prefix`,
      );
    }
  }
  for (const prefix of Object.keys(ordering.duplicatePrefixes)) {
    if ((byPrefix.get(prefix)?.length ?? 0) < 2) {
      failures.push(
        `${ORDERING_PATH}: prefix ${prefix} is no longer shared; delete its entry`,
      );
    }
  }

  const numbers = [...byPrefix.keys()].map(Number).sort((a, b) => a - b);
  const declaredGaps = new Set(Object.keys(ordering.skippedPrefixes));
  for (let index = 1; index < numbers.length; index += 1) {
    for (
      let missing = numbers[index - 1]! + 1;
      missing < numbers[index]!;
      missing += 1
    ) {
      const label = String(missing).padStart(4, "0");
      if (!declaredGaps.has(label)) {
        failures.push(
          `prefix ${label} is skipped; a gap in the sequence must be declared in ${ORDERING_PATH}`,
        );
      }
    }
  }
  const present = new Set(byPrefix.keys());
  for (const prefix of declaredGaps) {
    if (present.has(prefix)) {
      failures.push(
        `${ORDERING_PATH}: prefix ${prefix} is no longer skipped; delete its entry`,
      );
    }
  }

  // The comparator every applier uses must agree with numeric order.
  const byName = [...names].sort((a, b) => a.localeCompare(b));
  const byNumber = [...names].sort((a, b) => {
    const left = Number(a.slice(0, 4));
    const right = Number(b.slice(0, 4));
    return left === right ? a.localeCompare(b) : left - right;
  });
  if (byName.join("\n") !== byNumber.join("\n")) {
    failures.push(
      "ordering by file name no longer matches ordering by prefix number; a live database has already applied the file-name order",
    );
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
