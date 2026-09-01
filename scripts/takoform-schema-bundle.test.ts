import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  buildSchemaBundle,
  BUNDLE_RELATIVE_PATH,
  generateSchemaBundle,
  MIGRATION_DIRECTORY,
} from "./generate-takoform-schema-bundle.ts";

const root = resolve(import.meta.dir, "..");

describe("Takos portable relational schema bundle", () => {
  test("is an exact reproducible projection of the canonical migrations", async () => {
    const tracked = await readFile(join(root, BUNDLE_RELATIVE_PATH), "utf8");
    expect(tracked).toBe(await generateSchemaBundle(root));
    const bundle = await buildSchemaBundle(root);
    expect(bundle.apiVersion).toBe("takosumi.resource-migrations/v1");
    expect(bundle.engine).toBe("sqlite");
    expect(bundle.entries.length).toBeGreaterThan(0);

    for (const entry of bundle.entries) {
      const bytes = await readFile(join(root, MIGRATION_DIRECTORY, entry.name));
      expect(entry.sql).toBe(bytes.toString("utf8"));
      expect(entry.sha256).toBe(
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      );
    }
  });

  test("keeps migration order deterministic and names unique", async () => {
    const bundle = await buildSchemaBundle(root);
    const names = bundle.entries.map(({ name }) => name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  test("pins the portable database to the same immutable release as the Worker", async () => {
    const moduleSource = await readFile(
      join(root, "deploy/opentofu/takoform/main.tf"),
      "utf8",
    );
    const workerReleaseTag = variableDefault(
      moduleSource,
      "worker_release_tag",
    );
    const schemaUrl = variableDefault(moduleSource, "database_schema_url");
    const schemaDigest = variableDefault(
      moduleSource,
      "database_schema_sha256",
    );
    const parsedUrl = new URL(schemaUrl);

    expect(parsedUrl.protocol).toBe("https:");
    expect(parsedUrl.username).toBe("");
    expect(parsedUrl.password).toBe("");
    expect(parsedUrl.search).toBe("");
    expect(parsedUrl.hash).toBe("");
    expect(parsedUrl.pathname).toContain(`/${workerReleaseTag}/`);
    expect(parsedUrl.pathname).toEndWith(
      "/deploy/opentofu/takoform/migrations/schema-bundle.json",
    );
    expect(schemaDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(moduleSource).toContain(
      "schema_url    = trimspace(var.database_schema_url)",
    );
    expect(moduleSource).toContain(
      "schema_sha256 = trimspace(var.database_schema_sha256)",
    );
    expect(moduleSource).toContain(
      'format("/%s/", trimspace(var.worker_release_tag))',
    );
    expect(moduleSource).toContain(
      'schema_format = "takosumi.resource-migrations"',
    );
  });
});

function variableDefault(source: string, name: string): string {
  const marker = `variable "${name}" {`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing OpenTofu variable: ${name}`);
  const next = source.indexOf('\nvariable "', start + marker.length);
  const block = source.slice(start, next < 0 ? source.length : next);
  const match = block.match(/\bdefault\s*=\s*"([^"]+)"/u);
  if (!match?.[1]) throw new Error(`Missing OpenTofu default: ${name}`);
  return match[1];
}
