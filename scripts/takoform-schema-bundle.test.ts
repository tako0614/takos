import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  BUNDLE_RELATIVE_PATH,
  MIGRATION_DIRECTORY,
  buildSchemaBundle,
  generateSchemaBundle,
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
});
