import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  buildPortableTestInventory,
  discoverChangedInputs,
  discoverTrackedPortableTests,
  loadPortableTestExclusions,
  requiresCompletePortableTests,
  validatePortableTestExclusions,
} from "../portable-test-inventory.ts";

const repoRoot = resolve(import.meta.dir, "../..");
const packageJson = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("portable owner gate", () => {
  test("selects every tracked portable test file exactly once", () => {
    const exclusions = loadPortableTestExclusions(repoRoot);
    expect(validatePortableTestExclusions(exclusions, repoRoot)).toEqual([]);

    const inventory = buildPortableTestInventory(repoRoot, exclusions);
    expect(inventory.duplicates).toEqual([]);
    expect(inventory.missing).toEqual([]);
    expect(inventory.selected.length).toBeGreaterThan(0);
    expect(new Set(inventory.selected).size).toBe(inventory.selected.length);
  });

  test("runs the complete inventory through one command without Web duplicates", () => {
    const scripts = packageJson.scripts ?? {};
    expect(scripts.test).toContain("bun run test:portable");
    expect(scripts["test:portable"]).toContain(
      "scripts/run-portable-tests.ts",
    );
    expect(scripts.test).not.toContain("test:web");
    expect(scripts.test).not.toContain("test:product-contracts");
    expect(scripts["test:product-contracts"] ?? "").not.toContain(
      "web/src/__tests__",
    );
  });

  test("builds the Web artifact once and validates that exact artifact", () => {
    const check = packageJson.scripts?.check ?? "";
    expect(check).toContain("bun run build");
    expect(check).toContain(
      "bun run validate:dependency-security -- --artifact dist",
    );
    expect(check.match(/bun run web:build/g) ?? []).toHaveLength(0);
    expect(packageJson.scripts?.["validate:dependency-security"]).toContain(
      "scripts/validate-dependency-security.ts",
    );
  });

  test("rejects malformed and stale nonportable exclusions", () => {
    const malformed = {
      kind: "takos.portable-test-exclusions@v1" as const,
      maxEntries: 16,
      exclusions: [
        {
          path: "src/missing.test.ts",
          capability: "",
          reason: "",
          owningCadence: "",
        },
      ],
    };
    expect(validatePortableTestExclusions(malformed, repoRoot).length).toBe(
      4,
    );

    const stale = {
      kind: "takos.portable-test-exclusions@v1" as const,
      maxEntries: 16,
      exclusions: [
        {
          path: "src/missing.test.ts",
          capability: "live-service",
          reason: "Requires the operator-owned live service.",
          owningCadence: "live-e2e",
        },
      ],
    };
    expect(
      validatePortableTestExclusions(stale, repoRoot).some((error) =>
        error.includes("does not exist"),
      ),
    ).toBe(true);
  });

  test("includes non-ignored untracked tests and ignores fixture tests", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "takos-portable-inventory-"));
    try {
      await mkdir(resolve(root, "src"), { recursive: true });
      await mkdir(resolve(root, "fixtures"), { recursive: true });
      await writeFile(resolve(root, "tracked.test.ts"), "export {};\n");
      await writeFile(resolve(root, "src/untracked.test.ts"), "export {};\n");
      await writeFile(resolve(root, "ignored.test.ts"), "export {};\n");
      await writeFile(resolve(root, "fixtures/ignored.test.ts"), "export {};\n");
      await writeFile(resolve(root, ".gitignore"), "ignored.test.ts\nfixtures/\n");

      const init = Bun.spawnSync({
        cmd: ["git", "init", "-q"],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(init.exitCode).toBe(0);
      const add = Bun.spawnSync({
        cmd: ["git", "add", ".gitignore", "tracked.test.ts"],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(add.exitCode).toBe(0);

      expect(discoverTrackedPortableTests(root)).toEqual([
        "src/untracked.test.ts",
        "tracked.test.ts",
      ].sort((left, right) => left.localeCompare(right)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses the complete portable gate for global inputs", () => {
    expect(requiresCompletePortableTests(["src/worker.ts"])).toBe(false);
    expect(requiresCompletePortableTests(["package.json"])).toBe(true);
    expect(requiresCompletePortableTests(["bun.lock"])).toBe(true);
    expect(requiresCompletePortableTests(["web/vite.config.ts"])).toBe(true);
    expect(requiresCompletePortableTests(["compose.local.yml"])).toBe(true);
    expect(requiresCompletePortableTests(["src/new-feature.test.ts"])).toBe(
      false,
    );
  });

  test("includes staged-only global inputs in the complete fallback decision", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "takos-portable-staged-"));
    try {
      await writeFile(resolve(root, "package.json"), '{"name":"fixture"}\n');
      await writeFile(resolve(root, "feature.test.ts"), "export {};\n");
      const init = Bun.spawnSync({
        cmd: ["git", "init", "-q"],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(init.exitCode).toBe(0);
      const add = Bun.spawnSync({
        cmd: ["git", "add", "package.json"],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(add.exitCode).toBe(0);

      const changed = discoverChangedInputs(root);
      expect(changed).toContain("package.json");
      expect(requiresCompletePortableTests(changed)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
