import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MAXIMUM_WORKER_ARCHIVE_BYTES,
  PINNED_WORKER_ARCHIVE_SHA256,
  PINNED_WORKER_ARCHIVE_URL,
  buildOpentofuWorkerArtifact,
  collectMigrationFiles,
} from "./build-opentofu-worker-artifact.ts";

const root = new URL("../", import.meta.url);

test("the Worker artifact contract is module-local and source-build stays credential-free", async () => {
  const manifest = JSON.parse(
    await readFile(new URL(".well-known/takosumi.json", root), "utf8"),
  ) as {
    install: {
      modules: Record<string, { sourceBuild?: { commands: unknown[]; outputs: string[] } }>;
    };
  };
  const sourceBuild = manifest.install.modules["deploy/opentofu/cloudflare"]?.sourceBuild;
  expect(sourceBuild?.commands).toEqual([
    { argv: ["bun", "run", "build:opentofu-worker-artifact"] },
  ]);
  expect(sourceBuild?.outputs).toEqual([
    "deploy/opentofu/cloudflare/.takos-build/worker/index.js",
    "deploy/opentofu/cloudflare/.takos-build/assets",
    "deploy/opentofu/cloudflare/.takos-build/bridge/takos-cloudflare-opentofu-bridge.ts",
    "deploy/opentofu/cloudflare/.takos-build/migrations",
    "deploy/opentofu/cloudflare/.takos-build/container-desired.json",
    "deploy/opentofu/cloudflare/.takos-build/manifest.json",
  ]);
  expect(PINNED_WORKER_ARCHIVE_URL).toContain("releases/download/v0.12.7");
  expect(PINNED_WORKER_ARCHIVE_SHA256).toMatch(/^[a-f0-9]{64}$/u);
});

test("canonical migration collection retains independently named duplicate versions", async () => {
  const files = await collectMigrationFiles(
    new URL("../db/migrations-control/migrations", import.meta.url).pathname,
  );
  const duplicateVersion = files.filter(({ path }) => path.startsWith("0043_"));
  expect(duplicateVersion.map(({ path }) => path)).toEqual([
    "0043_ap_followers.sql",
    "0043_store_network_inventory_metadata.sql",
  ]);
  expect(duplicateVersion[0]?.sha256).not.toBe(duplicateVersion[1]?.sha256);
  expect(files.every(({ path }) => path.endsWith(".sql"))).toBe(true);
  expect(files).toEqual([...files].sort((a, b) => a.path.localeCompare(b.path)));
});

test("archive materialization rejects bytes that do not match the repository pin", async () => {
  const temporaryRoot = await mkdtemp("takos-opentofu-artifact-test-");
  try {
    await writeFile(join(temporaryRoot, "scripts-placeholder"), "unused");
    await expect(
      buildOpentofuWorkerArtifact({
        rootDirectory: temporaryRoot,
        fetchImpl: async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "application/gzip" },
          }),
      }),
    ).rejects.toThrow("SHA-256");
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("archive materialization rejects an oversized response before buffering it", async () => {
  const temporaryRoot = await mkdtemp("takos-opentofu-artifact-test-");
  try {
    await expect(
      buildOpentofuWorkerArtifact({
        rootDirectory: temporaryRoot,
        fetchImpl: async () =>
          new Response("bounded-test", {
            status: 200,
            headers: {
              "content-length": String(MAXIMUM_WORKER_ARCHIVE_BYTES + 1),
            },
          }),
      }),
    ).rejects.toThrow("source-build bound");
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
