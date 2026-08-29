import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  parseDependencySecurityArgs,
  validateProductionSanitizerBundle,
  validateSecurityOverrides,
  validateAuditFindings,
  validateReviewWindow,
  validateWaiverScope,
  validateVulnerableToolOccurrences,
  validateWebBuildArtifact,
} from "../validate-dependency-security.ts";
import {
  trackedWebInputs,
  writeWebBuildManifest,
} from "../build-web.ts";

const evidence = {
  kind: "takos.dependency-audit-waivers@v1" as const,
  reviewedAt: "2026-08-29",
  reviewAfter: "2026-09-12",
  scope: {
    owner: "vitepress" as const,
    ownerVersion: "1.6.4",
    ownerDependencyRange: "^5.4.14",
    viteVersion: "5.4.21",
    esbuildVersion: "0.21.5",
    vulnerableOccurrences: [
      {
        package: "esbuild" as const,
        version: "0.21.5",
        path: "node_modules/vitepress/node_modules/vite/node_modules/esbuild/package.json",
      },
      {
        package: "vite" as const,
        version: "5.4.21",
        path: "node_modules/vitepress/node_modules/vite/package.json",
      },
    ],
    devOnly: true as const,
    productionReachable: false as const,
    condition: "Windows development server only",
    upstreamTracking: "https://github.com/vuejs/vitepress/releases",
    removeWhen: "Remove after a stable VitePress release accepts a fixed Vite.",
  },
  advisories: [
    {
      package: "vite",
      id: 1123525,
      url: "https://github.com/advisories/GHSA-fx2h-pf6j-xcff",
      title: "vite: `server.fs.deny` bypass on Windows alternate paths",
      severity: "high",
      vulnerableVersions: "<=6.4.2",
    },
  ],
};

const audit = {
  vite: [
    {
      id: 1123525,
      url: "https://github.com/advisories/GHSA-fx2h-pf6j-xcff",
      title: "vite: `server.fs.deny` bypass on Windows alternate paths",
      severity: "high",
      vulnerable_versions: "<=6.4.2",
    },
  ],
};

describe("dependency security gate", () => {
  test("uses the already-built artifact when the owner gate passes an artifact", () => {
    expect(parseDependencySecurityArgs(["--artifact", "dist"])).toEqual({
      artifactRoot: expect.stringMatching(/\/dist$/),
      buildArtifact: false,
    });
    expect(parseDependencySecurityArgs(["--artifact=dist"])).toEqual({
      artifactRoot: expect.stringMatching(/\/dist$/),
      buildArtifact: false,
    });
    expect(parseDependencySecurityArgs(["--build"]).buildArtifact).toBe(true);
    expect(() => parseDependencySecurityArgs(["--artifact"])).toThrow(
      "--artifact requires a directory",
    );
  });

  test("accepts only the exact reviewed dev-only advisory", () => {
    expect(validateAuditFindings(audit, evidence)).toEqual([]);
    expect(validateReviewWindow(evidence, "2026-08-29")).toEqual([]);
    expect(
      validateVulnerableToolOccurrences(
        evidence.scope.vulnerableOccurrences,
        evidence,
      ),
    ).toEqual([]);
    expect(
      validateWaiverScope(
        { devDependencies: { vitepress: "^1.6.4" } },
        {
          name: "vitepress",
          version: "1.6.4",
          dependencies: { vite: "^5.4.14" },
        },
        { name: "vite", version: "5.4.21" },
        { name: "esbuild", version: "0.21.5" },
        evidence,
      ),
    ).toEqual([]);
  });

  test("rejects a new advisory and a changed dependency path", () => {
    const changedAudit = {
      ...audit,
      unexpected: [
        {
          id: 1,
          url: "https://example.invalid/advisory",
          title: "unexpected production issue",
          severity: "critical",
          vulnerable_versions: "*",
        },
      ],
    };
    expect(
      validateAuditFindings(changedAudit, evidence).length,
    ).toBeGreaterThan(0);
    expect(validateReviewWindow(evidence, "2026-09-13")).toEqual([
      "the dependency waiver review window expired on 2026-09-12",
    ]);
    expect(
      validateVulnerableToolOccurrences(
        [
          ...evidence.scope.vulnerableOccurrences,
          {
            package: "vite",
            version: "5.4.21",
            path: "node_modules/production-server/node_modules/vite/package.json",
          },
        ],
        evidence,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateWaiverScope(
        { dependencies: { vitepress: "^1.6.4" } },
        {
          name: "vitepress",
          version: "1.6.4",
          dependencies: { vite: "^5.4.14" },
        },
        { name: "vite", version: "6.4.3" },
        { name: "esbuild", version: "0.21.5" },
        evidence,
      ).length,
    ).toBeGreaterThan(0);
  });

  test("binds every security override to package.json, bun.lock, and node_modules", () => {
    const rootPackage = { overrides: { hono: "4.13.1" } };
    const lockfile = {
      overrides: { hono: "4.13.1" },
      packages: {
        hono: ["hono@4.13.1", "", {}, "sha512-test"],
      },
    };
    const installed = [
      {
        package: "hono",
        version: "4.13.1",
        path: "node_modules/hono/package.json",
      },
    ];
    expect(validateSecurityOverrides(rootPackage, lockfile, installed)).toEqual(
      [],
    );

    const nestedLockfile = {
      ...lockfile,
      packages: {
        ...lockfile.packages,
        "parent/hono": ["hono@4.13.1", "", {}, "sha512-test"],
      },
    };
    const nestedInstalled = [
      ...installed,
      {
        package: "hono",
        version: "4.13.1",
        path: "node_modules/parent/node_modules/hono/package.json",
      },
    ];
    expect(
      validateSecurityOverrides(rootPackage, nestedLockfile, nestedInstalled),
    ).toEqual([]);
    expect(
      validateSecurityOverrides(
        rootPackage,
        {
          ...nestedLockfile,
          packages: {
            ...nestedLockfile.packages,
            "parent/hono": ["hono@4.12.0", "", {}, "sha512-test"],
          },
        },
        nestedInstalled,
      ).some((error) => error.includes("bun.lock resolves hono")),
    ).toBe(true);
    expect(
      validateSecurityOverrides(rootPackage, nestedLockfile, [
        ...installed,
        {
          package: "hono",
          version: "4.12.0",
          path: "node_modules/parent/node_modules/hono/package.json",
        },
      ]).some((error) => error.includes("node_modules resolves hono")),
    ).toBe(true);

    expect(
      validateSecurityOverrides(
        { overrides: { hono: "4.12.0" } },
        lockfile,
        installed,
      ).some((error) => error.includes("bun.lock override map")),
    ).toBe(true);
    expect(
      validateSecurityOverrides(
        rootPackage,
        {
          ...lockfile,
          packages: { hono: ["hono@4.12.0", "", {}, "sha512-test"] },
        },
        installed,
      ).some((error) => error.includes("bun.lock resolves hono")),
    ).toBe(true);
    expect(
      validateSecurityOverrides(rootPackage, lockfile, [
        { ...installed[0], version: "4.12.0" },
      ]).some((error) => error.includes("node_modules resolves hono")),
    ).toBe(true);
  });

  test("accepts a fresh bundle and rejects source/artifact tampering", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "takos-security-artifact-"));
    const sourcePath = resolve(root, "web/index.ts");
    const assetPath = resolve(root, "dist/assets/index.js");
    try {
      await mkdir(resolve(root, "web"), { recursive: true });
      await mkdir(resolve(root, "scripts"), { recursive: true });
      await mkdir(resolve(root, "dist/assets"), { recursive: true });
      await writeFile(sourcePath, "export const fresh = true;\n");
      await writeFile(resolve(root, "package.json"), "{}\n");
      await writeFile(resolve(root, "bun.lock"), "{}\n");
      await writeFile(resolve(root, "scripts/build-web.ts"), "export {};\n");
      await writeFile(
        assetPath,
        "takos.monaco-dompurify@3.4.13\n",
      );
      const untrackedSourcePath = resolve(root, "web/untracked-build-input.ts");

      const init = Bun.spawnSync({
        cmd: ["git", "init", "-q"],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(init.exitCode).toBe(0);
      const add = Bun.spawnSync({
        cmd: ["git", "add", "."],
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(add.exitCode).toBe(0);

      await writeFile(untrackedSourcePath, "export const untracked = true;\n");
      const sourceFiles = trackedWebInputs(root);
      expect(sourceFiles).toContain("web/untracked-build-input.ts");
      writeWebBuildManifest(resolve(root, "dist"), sourceFiles, root);
      expect(validateWebBuildArtifact(resolve(root, "dist"), root)).toEqual(
        [],
      );
      expect(validateProductionSanitizerBundle(resolve(root, "dist"))).toEqual(
        [],
      );

      await writeFile(sourcePath, "export const fresh = false;\n");
      expect(
        validateWebBuildArtifact(resolve(root, "dist"), root),
      ).toContain("Web build source digest is stale; rebuild the artifact");
      await writeFile(sourcePath, "export const fresh = true;\n");

      await writeFile(untrackedSourcePath, "export const untracked = false;\n");
      expect(
        validateWebBuildArtifact(resolve(root, "dist"), root),
      ).toContain("Web build source digest is stale; rebuild the artifact");
      await writeFile(untrackedSourcePath, "export const untracked = true;\n");

      await writeFile(assetPath, "tampered\n");
      expect(
        validateWebBuildArtifact(resolve(root, "dist"), root),
      ).toContain("Web build artifact digest does not match its manifest");
      await writeFile(assetPath, "takos.monaco-dompurify@3.4.12\n");
      expect(
        validateProductionSanitizerBundle(resolve(root, "dist")),
      ).toContain(
        "production bundle must contain exactly one secure Monaco sanitizer proof (received 0)",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
