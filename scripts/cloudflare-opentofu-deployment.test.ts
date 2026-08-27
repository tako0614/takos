import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

test("migration bootstrap exports real Durable Object classes for container namespaces", async () => {
  const source = await readFile(
    resolve(
      repositoryRoot,
      "deploy/opentofu/cloudflare/modules/platform/durable-object-migration-bootstrap.js",
    ),
    "utf8",
  );

  expect(source).toContain(
    'import { DurableObject } from "cloudflare:workers";',
  );
  expect(source).toContain(
    "class MigrationBootstrapDurableObject extends DurableObject",
  );

  for (const className of [
    "ExecutorContainerTier1",
    "ExecutorContainerTier2",
    "ExecutorContainerTier3",
  ]) {
    expect(source).toContain(
      `export class ${className} extends MigrationBootstrapDurableObject`,
    );
  }
});
