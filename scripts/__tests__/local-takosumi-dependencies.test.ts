import { describe, expect, test } from "bun:test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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
  async function writeRequiredFixtureFiles(fixture: string): Promise<void> {
    await mkdir(join(fixture, "core"), { recursive: true });
    await Promise.all([
      writeFile(join(fixture, "package.json"), JSON.stringify({})),
      writeFile(join(fixture, "bun.lock"), '{"lockfileVersion":1}\n'),
      writeFile(join(fixture, "core", "index.ts"), "export {};\n"),
    ]);
  }

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
    await mkdir(join(fixture, "providers", "git"), { recursive: true });
    await Promise.all([
      writeFile(join(fixture, "package.json"), packageText),
      writeFile(join(fixture, "bun.lock"), lockText),
      writeFile(join(fixture, "core", "index.ts"), "export {};\n"),
      writeFile(
        join(fixture, "providers", "git", "credentials.ts"),
        "export const source = true;\n",
      ),
      writeFile(
        join(fixture, "accounts", "contract", "package.json"),
        JSON.stringify({ name: "workspace-fixture" }),
      ),
    ]);

    let installRoot = "";
    const secretFiles = [
      ".dev.vars",
      ".dev.vars.production",
      ".env",
      ".env.local",
      ".npmrc",
      ".pypirc",
      "credentials.json",
      "service-account.json",
      "secrets.json",
      "id_rsa",
      "id_dsa.backup",
      "id_ecdsa.local",
      "id_ed25519",
    ];
    const placeholderFiles = [
      ".dev.vars.example",
      ".env.local.example",
      ".npmrc.sample",
      "credentials.json.template",
      "id_rsa.fixture",
      "id_ed25519.pub",
    ];
    await Promise.all([
      ...secretFiles.map((path) =>
        writeFile(join(fixture, path), "must-not-copy\n"),
      ),
      ...placeholderFiles.map((path) =>
        writeFile(join(fixture, path), "documented-placeholder\n"),
      ),
    ]);
    for (const directory of [
      ".aws",
      ".credentials",
      ".secrets",
      ".ssh",
      "certs",
      "secrets",
    ]) {
      await mkdir(join(fixture, directory));
      await writeFile(join(fixture, directory, "material"), "must-not-copy\n");
    }
    await mkdir(join(fixture, "certs.example"));
    await writeFile(
      join(fixture, "certs.example", "public.pem.example"),
      "documented-placeholder\n",
    );
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
      expect(
        await readFile(
          join(installRoot, "providers", "git", "credentials.ts"),
          "utf8",
        ),
      ).toContain("source = true");
      expect(prepared.lockDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(prepared.nodeModulesPath).toBe(
        join(prepared.workspaceRoot, "node_modules"),
      );
      for (const path of secretFiles) {
        await expect(access(join(installRoot, path))).rejects.toBeDefined();
      }
      for (const directory of [
        ".aws",
        ".credentials",
        ".secrets",
        ".ssh",
        "certs",
        "secrets",
      ]) {
        await expect(
          access(join(installRoot, directory)),
        ).rejects.toBeDefined();
      }
      for (const path of placeholderFiles) {
        expect(await readFile(join(installRoot, path), "utf8")).toBe(
          "documented-placeholder\n",
        );
      }
      expect(
        await readFile(
          join(installRoot, "certs.example", "public.pem.example"),
          "utf8",
        ),
      ).toBe("documented-placeholder\n");
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
    await writeRequiredFixtureFiles(fixture);
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

  test("rejects a source symlink before install without exposing its target", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "takosumi-source-fixture-"));
    const outside = await mkdtemp(join(tmpdir(), "takosumi-outside-fixture-"));
    const temporaryParent = await mkdtemp(
      join(tmpdir(), "takosumi-dependency-fixture-"),
    );
    await writeRequiredFixtureFiles(fixture);
    const outsideFile = join(outside, "do-not-expose");
    await writeFile(outsideFile, "outside-secret-value\n");
    await symlink(outsideFile, join(fixture, "ordinary-source-link"));
    let installCalled = false;
    let message = "";

    try {
      await prepareTakosumiDependencies({
        takosumiRoot: fixture,
        temporaryParent,
        install: async () => {
          installCalled = true;
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      await Promise.all([
        rm(fixture, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
        rm(temporaryParent, { recursive: true, force: true }),
      ]);
    }

    expect(installCalled).toBe(false);
    expect(message).toBe(
      "adjacent Takosumi source contains a symbolic link; local:e2e refuses to copy it",
    );
    expect(message).not.toContain(outsideFile);
    expect(message).not.toContain("outside-secret-value");
  });
});
