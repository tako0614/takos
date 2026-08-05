#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_DIRECTORY = "db/migrations-control/migrations";
export const BUNDLE_RELATIVE_PATH =
  "deploy/opentofu/takoform/migrations/schema-bundle.json";
export const MIGRATION_NAME_RE = /^[0-9]{4}_[A-Za-z0-9_-]+\.sql$/u;

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export type SchemaBundleEntry = {
  readonly name: string;
  readonly sha256: string;
  readonly sql: string;
};

export type SchemaBundle = {
  readonly apiVersion: "takosumi.resource-migrations/v1";
  readonly engine: "sqlite";
  readonly entries: readonly SchemaBundleEntry[];
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

export async function buildSchemaBundle(
  repositoryRoot = REPOSITORY_ROOT,
): Promise<SchemaBundle> {
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

  const entries: SchemaBundleEntry[] = [];
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

export function serializeSchemaBundle(bundle: SchemaBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
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
        `${BUNDLE_RELATIVE_PATH} is stale; run bun run generate:schema-bundle`,
      );
    }
    console.log(`${BUNDLE_RELATIVE_PATH} is up to date`);
    return;
  }

  if (actual === expected) {
    console.log(`${BUNDLE_RELATIVE_PATH} is already up to date`);
    return;
  }
  await mkdir(dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, expected, "utf8");
  console.log(`wrote ${BUNDLE_RELATIVE_PATH}`);
}

if (import.meta.main) {
  await writeOrCheckBundle(process.argv.includes("--check"));
}
