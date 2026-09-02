#!/usr/bin/env bun

/**
 * Generates the migration set the Worker embeds for runtime self-migration.
 *
 * The SQL source of truth stays `db/migrations-control/migrations`. The Worker
 * has no filesystem, so the set has to be part of the module graph; this script
 * derives it with the same reader the OpenTofu schema bundle uses, so a name
 * and its `sha256:` digest mean exactly the same thing on every install path.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSchemaBundle,
  serializeSchemaBundle,
} from "./generate-takoform-schema-bundle.ts";

export const RUNTIME_MIGRATION_SET_RELATIVE_PATH =
  "src/worker/platform/migrations/migration-set.generated.json";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export async function generateRuntimeMigrationSet(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<string> {
  return serializeSchemaBundle(await buildSchemaBundle(repositoryRoot));
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
