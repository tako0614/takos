import { describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupTakosumiDependencies,
  prepareTakosumiDependencies,
  takosumiWorkspaceManifestPaths,
} from "../local-takosumi-dependencies.ts";

describe("local Takosumi dependency preparation", () => {
  test("accepts only explicit workspace directories", () => {
    expect(
      takosumiWorkspaceManifestPaths(
        JSON.stringify({ workspaces: ["accounts/contract", "mobile-kit"] }),
      ),
    ).toEqual(["accounts/contract/package.json", "mobile-kit/package.json"]);
    expect(() =>
      takosumiWorkspaceManifestPaths(
        JSON.stringify({ workspaces: ["packages/*"] }),
      ),
    ).toThrow("explicit relative directory");
    expect(() =>
      takosumiWorkspaceManifestPaths(
        JSON.stringify({ workspaces: ["../outside"] }),
      ),
    ).toThrow("escapes or aliases its root");
  });

  test("copies source into an isolated frozen install workspace", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "takosumi-source-fixture-"));
    const temporaryParent = await mkdtemp(
      join(tmpdir(), "takosumi-dependency-fixture-"),
    );
    const packageText = JSON.stringify({
      name: "takosumi-fixture",
      workspaces: ["accounts/contract"],
    });
    const lockText = '{"lockfileVersion":1}\n';
    await mkdir(join(fixture, "accounts", "contract"), { recursive: true });
    await mkdir(join(fixture, "core"), { recursive: true });
    await Promise.all([
      writeFile(join(fixture, "package.json"), packageText),
      writeFile(join(fixture, "bun.lock"), lockText),
      writeFile(join(fixture, "core", "index.ts"), "export {};\n"),
      writeFile(
        join(fixture, "accounts", "contract", "package.json"),
        JSON.stringify({ name: "workspace-fixture" }),
      ),
    ]);

    let installRoot = "";
    await writeFile(join(fixture, ".env"), "SECRET=must-not-copy\n");
    await mkdir(join(fixture, "node_modules"));
    await writeFile(join(fixture, "node_modules", "stale"), "stale\n");

    const prepared = await prepareTakosumiDependencies({
      takosumiRoot: fixture,
      temporaryParent,
      install: async (dependencyRoot) => {
        installRoot = dependencyRoot;
        await mkdir(join(dependencyRoot, "node_modules"));
      },
    });

    try {
      expect(installRoot).toBe(prepared.workspaceRoot);
      expect(await readFile(join(installRoot, "package.json"), "utf8")).toBe(
        packageText,
      );
      expect(await readFile(join(installRoot, "bun.lock"), "utf8")).toBe(
        lockText,
      );
      expect(
        await readFile(
          join(installRoot, "accounts", "contract", "package.json"),
          "utf8",
        ),
      ).toContain("workspace-fixture");
      expect(prepared.lockDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(prepared.nodeModulesPath).toBe(
        join(prepared.workspaceRoot, "node_modules"),
      );
      await expect(access(join(installRoot, ".env"))).rejects.toBeDefined();
      await expect(
        access(join(installRoot, "node_modules", "stale")),
      ).rejects.toBeDefined();
    } finally {
      await cleanupTakosumiDependencies(prepared);
      await Promise.all([
        rm(fixture, { recursive: true, force: true }),
        rm(temporaryParent, { recursive: true, force: true }),
      ]);
    }
    await expect(access(prepared.workspaceRoot)).rejects.toBeDefined();
  });

  test("removes the isolated workspace when frozen install fails", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "takosumi-source-fixture-"));
    const temporaryParent = await mkdtemp(
      join(tmpdir(), "takosumi-dependency-fixture-"),
    );
    await mkdir(join(fixture, "core"), { recursive: true });
    await Promise.all([
      writeFile(join(fixture, "package.json"), JSON.stringify({})),
      writeFile(join(fixture, "bun.lock"), '{"lockfileVersion":1}\n'),
      writeFile(join(fixture, "core", "index.ts"), "export {};\n"),
    ]);
    let installRoot = "";

    try {
      await expect(
        prepareTakosumiDependencies({
          takosumiRoot: fixture,
          temporaryParent,
          install: async (dependencyRoot) => {
            installRoot = dependencyRoot;
            throw new Error("frozen install rejected");
          },
        }),
      ).rejects.toThrow("frozen install rejected");
      await expect(access(installRoot)).rejects.toBeDefined();
    } finally {
      await Promise.all([
        rm(fixture, { recursive: true, force: true }),
        rm(temporaryParent, { recursive: true, force: true }),
      ]);
    }
  });
});
