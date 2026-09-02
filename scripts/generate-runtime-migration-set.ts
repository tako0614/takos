#!/usr/bin/env bun

/**
 * Generates the migration set the Worker embeds for runtime self-migration.
 *
 * The SQL source of truth stays `db/migrations-control/migrations`. The Worker
 * has no filesystem, so the set has to be part of the module graph. This file
 * owns the single canonical reader: a name and its `sha256:` digest mean
 * exactly the same thing on every install path because every install path now
 * converges on the Worker applying this set at runtime.
 *
 * `deploy/opentofu/takoform/migrations/schema-bundle.json` is a byte-identical
 * projection of the same reader, retained as release history for the retired
 * Provider 1.x tree. It is not a second live derived artifact; see
 * `scripts/generate-takoform-schema-bundle.ts`.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_DIRECTORY = "db/migrations-control/migrations";
export const MIGRATION_NAME_RE = /^[0-9]{4}_[A-Za-z0-9_-]+\.sql$/u;
export const RUNTIME_MIGRATION_SET_RELATIVE_PATH =
  "src/worker/platform/migrations/migration-set.generated.json";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export type MigrationSetEntry = {
  readonly name: string;
  readonly sha256: string;
  readonly sql: string;
};

export type MigrationSet = {
  readonly apiVersion: "takosumi.resource-migrations/v1";
  readonly engine: "sqlite";
  readonly entries: readonly MigrationSetEntry[];
};

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeUtf8(bytes: Uint8Array, name: string): string {
  let sql: string;
  try {
    sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`migration ${name} is not valid UTF-8`);
  }
  const roundTrip = new TextEncoder().encode(sql);
  if (
    roundTrip.byteLength !== bytes.byteLength ||
    roundTrip.some((byte, index) => byte !== bytes[index])
  ) {
    throw new Error(`migration ${name} changed when decoded as UTF-8`);
  }
  return sql;
}

export async function buildMigrationSet(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<MigrationSet> {
  const migrationDirectory = join(repositoryRoot, MIGRATION_DIRECTORY);
  const names = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    throw new Error(`no SQL migrations found in ${MIGRATION_DIRECTORY}`);
  }
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (!MIGRATION_NAME_RE.test(name)) {
      throw new Error(`migration name is invalid: ${name}`);
    }
    if (index > 0 && names[index - 1]! >= name) {
      throw new Error(`migration names are not strictly ascending: ${name}`);
    }
  }

  const entries: MigrationSetEntry[] = [];
  for (const name of names) {
    const bytes = new Uint8Array(
      await readFile(join(migrationDirectory, name)),
    );
    entries.push({
      name,
      sha256: sha256(bytes),
      sql: decodeUtf8(bytes, name),
    });
  }

  return {
    apiVersion: "takosumi.resource-migrations/v1",
    engine: "sqlite",
    entries,
  };
}

export function serializeMigrationSet(set: MigrationSet): string {
  return `${JSON.stringify(set, null, 2)}\n`;
}

export async function generateRuntimeMigrationSet(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<string> {
  return serializeMigrationSet(await buildMigrationSet(repositoryRoot));
}

async function writeOrCheck(checkOnly: boolean): Promise<void> {
  const expected = await generateRuntimeMigrationSet(REPOSITORY_ROOT);
  const setPath = join(REPOSITORY_ROOT, RUNTIME_MIGRATION_SET_RELATIVE_PATH);
  let actual: string | undefined;
  try {
    actual = await readFile(setPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (checkOnly) {
    if (actual !== expected) {
      throw new Error(
        `${RUNTIME_MIGRATION_SET_RELATIVE_PATH} is stale; run bun run generate:migration-set`,
      );
    }
    console.log(`${RUNTIME_MIGRATION_SET_RELATIVE_PATH} is up to date`);
    return;
  }

  if (actual === expected) {
    console.log(
      `${RUNTIME_MIGRATION_SET_RELATIVE_PATH} is already up to date`,
    );
    return;
  }
  await mkdir(dirname(setPath), { recursive: true });
  await writeFile(setPath, expected, "utf8");
  console.log(`wrote ${RUNTIME_MIGRATION_SET_RELATIVE_PATH}`);
}

if (import.meta.main) {
  await writeOrCheck(process.argv.includes("--check"));
}
