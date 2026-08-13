import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWorkerReleaseArtifact } from "./build-worker-release-artifact.ts";

test("Worker archive identity is independent of the source commit timestamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-worker-fixed-point-test-"));
  const bundleDir = join(root, "bundle");
  const assetsDir = join(root, "assets");
  const imageDigestDir = join(root, "images");
  const firstOutput = join(root, "first");
  const secondOutput = join(root, "second");
  const previousEpoch = process.env.SOURCE_DATE_EPOCH;

  try {
    await Promise.all([
      mkdir(bundleDir),
      mkdir(assetsDir),
      mkdir(imageDigestDir),
    ]);
    await writeFile(join(bundleDir, "index.js"), "export default { fetch() {} };\n");
    await writeFile(join(assetsDir, "index.html"), "<!doctype html><title>Takos</title>\n");

    process.env.SOURCE_DATE_EPOCH = "1710000000";
    await buildWorkerReleaseArtifact({
      bundleDir,
      assetsDir,
      imageDigestDir,
      outputDir: firstOutput,
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });

    process.env.SOURCE_DATE_EPOCH = "1720000000";
    await buildWorkerReleaseArtifact({
      bundleDir,
      assetsDir,
      imageDigestDir,
      outputDir: secondOutput,
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });

    const [first, second] = await Promise.all([
      readFile(join(firstOutput, "takos-worker-release.tar.gz")),
      readFile(join(secondOutput, "takos-worker-release.tar.gz")),
    ]);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
    expect(second).toEqual(first);
  } finally {
    if (previousEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previousEpoch;
    await rm(root, { recursive: true, force: true });
  }
});
