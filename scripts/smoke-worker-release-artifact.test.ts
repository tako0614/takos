import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWorkerReleaseArtifact } from "./build-worker-release-artifact.ts";
import { smokeWorkerReleaseArchive } from "./smoke-worker-release-artifact.ts";

test("boots exact release archive bytes and exercises Takos minimum HTTP contracts", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "takos-worker-smoke-test-"));
  const bundleDir = join(temporary, "bundle");
  const assetsDir = join(temporary, "assets");
  const imageDigestDir = join(temporary, "images");
  const outputDir = join(temporary, "output");
  try {
    await Promise.all([
      mkdir(bundleDir),
      mkdir(assetsDir),
      mkdir(imageDigestDir),
    ]);
    await writeFile(
      join(bundleDir, "index.js"),
      `export class SessionDO {}
export class RunNotifierDO {}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (url.pathname === "/api/auth/me") {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (url.pathname === "/.well-known/takosumi") {
      return Response.json({
        product: "takosumi",
        apiBaseUrl: url.origin + "/api/v1",
        features: {},
      });
    }
    return new Response("Not Found", { status: 404 });
  },
};
`,
    );
    await writeFile(join(assetsDir, "index.html"), "<!doctype html><title>Takos</title>\n");
    await buildWorkerReleaseArtifact({
      bundleDir,
      assetsDir,
      imageDigestDir,
      outputDir,
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
      takosumiCompositionSource: {
        kind: "takos.takosumi-composition-source@v1",
        repository: "tako0614/takosumi",
        commit: "d348acf853eb692f7be5df8115c1ab4490f845c6",
        pinDigest:
          "sha256:ef2a8db15c30782021f5d2d10a87e20479589967b3fef4c99ee405e06dcaf62f",
      },
    });

    const result = await smokeWorkerReleaseArchive(
      new URL("../", import.meta.url).pathname,
      join(outputDir, "takos-worker-release.tar.gz"),
    );

    expect(result).toMatchObject({
      kind: "takos.worker-release-smoke@v1",
      runtime: "wrangler-local-workerd",
      health: { path: "/health", status: 200 },
      api: { path: "/api/auth/me", status: 401 },
      productDiscovery: {
        path: "/.well-known/takosumi",
        status: 200,
        apiPath: "/api/v1",
      },
    });
    expect(result.archiveDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
