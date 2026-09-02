#!/usr/bin/env bun

/**
 * Regenerates the retained Provider 1.x schema bundle.
 *
 * `deploy/opentofu/takoform/` is release history: its HCL is named
 * `main.tf.history` so nothing can select it as an installable module, and
 * `main.tf.history` pins this bundle by `schema_sha256`. The bundle is kept in
 * the tree so that pin stays checkable, not because anything installs it.
 *
 * The single live derived migration artifact is
 * `src/worker/platform/migrations/migration-set.generated.json`, which the
 * Worker embeds and applies at runtime. This file emits byte-identical content
 * from the same reader (`scripts/generate-runtime-migration-set.ts`) so the
 * retained history cannot drift into a second, differently-shaped truth.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMigrationSet,
  MIGRATION_DIRECTORY,
  MIGRATION_NAME_RE,
  serializeMigrationSet,
  type MigrationSet,
  type MigrationSetEntry,
} from "./generate-runtime-migration-set.ts";

export { MIGRATION_DIRECTORY, MIGRATION_NAME_RE };
export type SchemaBundle = MigrationSet;
export type SchemaBundleEntry = MigrationSetEntry;

export const BUNDLE_RELATIVE_PATH =
  "deploy/opentofu/takoform/migrations/schema-bundle.json";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export async function buildSchemaBundle(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<SchemaBundle> {
  return buildMigrationSet(repositoryRoot);
}

export function serializeSchemaBundle(bundle: SchemaBundle): string {
  return serializeMigrationSet(bundle);
}

export async function generateSchemaBundle(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<string> {
  return serializeSchemaBundle(await buildSchemaBundle(repositoryRoot));
}

async function writeOrCheckBundle(checkOnly: boolean): Promise<void> {
  const expected = await generateSchemaBundle(REPOSITORY_ROOT);
  const bundlePath = join(REPOSITORY_ROOT, BUNDLE_RELATIVE_PATH);
  let actual: string | undefined;
  try {
    actual = await readFile(bundlePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (checkOnly) {
    if (actual !== expected) {
      throw new Error(
        `${BUNDLE_RELATIVE_PATH} (retained Provider 1.x history) is stale; run bun run generate:schema-bundle`,
      );
    }
    console.log(
      `${BUNDLE_RELATIVE_PATH} is up to date (retained history; the live derived artifact is src/worker/platform/migrations/migration-set.generated.json)`,
    );
    return;
  }

  if (actual === expected) {
    console.log(`${BUNDLE_RELATIVE_PATH} is already up to date`);
    return;
  }
  await mkdir(dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, expected, "utf8");
  console.log(`wrote ${BUNDLE_RELATIVE_PATH} (retained Provider 1.x history)`);
}

if (import.meta.main) {
  await writeOrCheckBundle(process.argv.includes("--check"));
}
