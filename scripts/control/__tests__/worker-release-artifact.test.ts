import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkerReleaseArtifact } from "../../build-worker-release-artifact.ts";
import {
  prepareWorkerReleaseArtifact,
  workerReleaseArtifactConfig,
} from "../worker-release-artifact.mjs";

const runtimeImage = "registry.cloudflare.com/acc/takos-worker-runtime:v0.10.1";
const executorImage =
  "registry.cloudflare.com/acc/takos-agent-executor:v0.10.1";

test("Worker release artifact packages a verified bundle and rewrites Wrangler paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-worker-artifact-test-"));
  try {
    const bundleDir = join(root, "bundle");
    const assetsDir = join(root, "assets");
    const imageDir = join(root, "images");
    const outputDir = join(root, "output");
    await mkdir(bundleDir, { recursive: true });
    await mkdir(join(assetsDir, "icons"), { recursive: true });
    await mkdir(imageDir, { recursive: true });
    await writeFile(
      join(bundleDir, "index.js"),
      "export default { fetch() { return new Response('ok') } };\n",
    );
    await writeFile(join(bundleDir, "index.js.map"), '{"sources":[]}\n');
    await writeFile(join(assetsDir, "index.html"), "<h1>Takos</h1>\n");
    await writeFile(join(assetsDir, "icons/logo.svg"), "<svg></svg>\n");
    await writeFile(
      join(imageDir, "runtime.json"),
      JSON.stringify({
        name: "takos-worker-runtime",
        cloudflareRegistryRef: runtimeImage,
      }),
    );
    await writeFile(
      join(imageDir, "executor.json"),
      JSON.stringify({
        name: "takos-agent-executor",
        cloudflareRegistryRef: executorImage,
      }),
    );

    const manifest = await buildWorkerReleaseArtifact({
      bundleDir,
      assetsDir,
      imageDigestDir: imageDir,
      outputDir,
      releaseTag: "v0.10.1",
      requireCloudflareContainerImages: true,
    });
    expect(manifest.kind).toBe("takosumi.worker-artifact@v1");
    expect(manifest.containerImages).toEqual({
      runtime: runtimeImage,
      executor: executorImage,
    });
    const repeated = await buildWorkerReleaseArtifact({
      bundleDir,
      assetsDir,
      imageDigestDir: imageDir,
      outputDir: join(root, "output-repeated"),
      releaseTag: "v0.10.1",
      requireCloudflareContainerImages: true,
    });
    expect(repeated.artifact.sha256).toBe(manifest.artifact.sha256);

    const wranglerConfig = join(root, "wrangler.toml");
    await writeFile(
      wranglerConfig,
      [
        'name = "takos"',
        'main = "src/index.ts"',
        "",
        "[assets]",
        'directory = "dist"',
        "",
      ].join("\n"),
    );
    const archive = await readFile(
      join(outputDir, "takos-worker-release.tar.gz"),
    );
    const prepared = await prepareWorkerReleaseArtifact({
      config: {
        url: manifest.artifact.url,
        sha256: manifest.artifact.sha256,
      },
      environment: "test",
      wranglerConfigPath: wranglerConfig,
      artifactRoot: join(root, "prepared"),
      fetchImpl: async () =>
        new Response(archive, {
          status: 200,
          headers: { "content-length": String(archive.byteLength) },
        }),
    });
    expect(await readFile(prepared.workerPath, "utf8")).toContain(
      "export default",
    );
    expect(
      await Bun.file(
        join(prepared.root, "content/worker/index.js.map"),
      ).exists(),
    ).toBe(false);
    const rendered = await readFile(wranglerConfig, "utf8");
    expect(rendered).toContain(`main = ${JSON.stringify(prepared.workerPath)}`);
    expect(rendered).toContain(
      `directory = ${JSON.stringify(prepared.assetsPath)}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker release artifact configuration requires HTTPS URL and matching SHA field", () => {
  expect(workerReleaseArtifactConfig({})).toBeUndefined();
  expect(() =>
    workerReleaseArtifactConfig({
      TAKOS_RELEASE_WORKER_ARTIFACT_URL: "https://example.com/release.tar.gz",
    }),
  ).toThrow(/must be set together/u);
  expect(() =>
    workerReleaseArtifactConfig({
      TAKOS_RELEASE_WORKER_ARTIFACT_URL: "http://example.com/release.tar.gz",
      TAKOS_RELEASE_WORKER_ARTIFACT_SHA256: "a".repeat(64),
    }),
  ).toThrow(/must use https/u);
});

test("Worker release artifact preparation rejects a digest mismatch before extraction", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-worker-artifact-digest-"));
  try {
    await expect(
      prepareWorkerReleaseArtifact({
        config: {
          url: "https://example.com/release.tar.gz",
          sha256: "a".repeat(64),
        },
        environment: "test",
        wranglerConfigPath: join(root, "wrangler.toml"),
        artifactRoot: join(root, "prepared"),
        fetchImpl: async () => new Response("not-an-archive", { status: 200 }),
      }),
    ).rejects.toThrow(/SHA-256 mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
