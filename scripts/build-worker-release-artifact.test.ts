import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildWorkerReleaseArtifact } from "./build-worker-release-artifact.ts";

test("future Worker release descriptors are Takos-owned and composition-free", async () => {
  const source = await readFile(
    join(import.meta.dir, "build-worker-release-artifact.ts"),
    "utf8",
  );
  expect(source).not.toContain("takosumiCompositionSource");
  expect(source).not.toContain("check-takosumi-composition-source");
  expect(source).toContain('kind: "takos.worker-artifact@v3"');
  expect(source).toContain('takos-artifact.json');
});

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
    const manifest = await buildWorkerReleaseArtifact({
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
    expect(manifest.artifact.size).toBe(first.byteLength);
  } finally {
    if (previousEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previousEpoch;
    await rm(root, { recursive: true, force: true });
  }
});

test("reuses identical archive bytes while retaining release tag and commit identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-worker-release-identity-test-"));
  const bundleDir = join(root, "bundle");
  const assetsDir = join(root, "assets");
  const imageDigestDir = join(root, "images");
  const firstOutput = join(root, "first");
  const secondOutput = join(root, "second");
  const previousGithubSha = process.env.GITHUB_SHA;
  const previousGithubRefName = process.env.GITHUB_REF_NAME;
  const releases = [
    {
      releaseTag: "v1.2.3",
      commit: "a".repeat(40),
    },
    {
      releaseTag: "v1.2.4",
      commit: "b".repeat(40),
    },
  ] as const;

  try {
    await Promise.all([
      mkdir(bundleDir),
      mkdir(assetsDir),
      mkdir(imageDigestDir),
    ]);
    await writeFile(join(bundleDir, "index.js"), "export default { fetch() {} };\n");
    await writeFile(join(assetsDir, "index.html"), "<!doctype html><title>Takos</title>\n");

    const manifests = [];
    for (const [index, release] of releases.entries()) {
      process.env.GITHUB_SHA = release.commit;
      process.env.GITHUB_REF_NAME = release.releaseTag;
      manifests.push(
        await buildWorkerReleaseArtifact({
          bundleDir,
          assetsDir,
          imageDigestDir,
          outputDir: index === 0 ? firstOutput : secondOutput,
          releaseTag: release.releaseTag,
          requireCloudflareContainerImages: false,
        }),
      );
    }

    const [firstArchive, secondArchive] = await Promise.all([
      readFile(join(firstOutput, "takos-worker-release.tar.gz")),
      readFile(join(secondOutput, "takos-worker-release.tar.gz")),
    ]);
    expect(secondArchive).toEqual(firstArchive);
    expect(manifests.map(({ releaseTag }) => releaseTag)).toEqual(
      releases.map(({ releaseTag }) => releaseTag),
    );
    expect(manifests.map(({ commit }) => commit)).toEqual(
      releases.map(({ commit }) => commit),
    );
    expect(manifests.map(({ ref }) => ref)).toEqual(
      releases.map(({ releaseTag }) => releaseTag),
    );
  } finally {
    if (previousGithubSha === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previousGithubSha;
    if (previousGithubRefName === undefined) delete process.env.GITHUB_REF_NAME;
    else process.env.GITHUB_REF_NAME = previousGithubRefName;
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker archive bytes and entry modes are canonical across process umasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-worker-umask-test-"));
  const bundleDir = join(root, "bundle");
  const assetsDir = join(root, "assets");
  const nestedAssetsDir = join(assetsDir, "nested");
  const imageDigestDir = join(root, "images");
  const firstOutput = join(root, "umask-022");
  const secondOutput = join(root, "umask-077");
  const runner = join(root, "build-under-umask.ts");

  try {
    await Promise.all([
      mkdir(bundleDir),
      mkdir(nestedAssetsDir, { recursive: true }),
      mkdir(imageDigestDir),
    ]);
    const worker = join(bundleDir, "index.js");
    const asset = join(nestedAssetsDir, "index.html");
    await writeFile(worker, "export default { fetch() {} };\n");
    await writeFile(asset, "<!doctype html><title>Takos</title>\n");
    await chmod(worker, 0o755);
    await chmod(nestedAssetsDir, 0o700);
    await chmod(asset, 0o600);
    await writeFile(
      runner,
      `const [mask, moduleUrl, optionsJson] = Bun.argv.slice(2);
if (!mask || !moduleUrl || !optionsJson) throw new Error("fixture arguments missing");
process.umask(Number.parseInt(mask, 8));
const { buildWorkerReleaseArtifact } = await import(moduleUrl);
await buildWorkerReleaseArtifact(JSON.parse(optionsJson));
`,
    );

    runBuildUnderUmask(runner, "022", {
      bundleDir,
      assetsDir,
      imageDigestDir,
      outputDir: firstOutput,
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });
    runBuildUnderUmask(runner, "077", {
      bundleDir,
      assetsDir,
      imageDigestDir,
      outputDir: secondOutput,
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });

    const firstArchive = join(firstOutput, "takos-worker-release.tar.gz");
    const secondArchive = join(secondOutput, "takos-worker-release.tar.gz");
    const [first, second] = await Promise.all([
      readFile(firstArchive),
      readFile(secondArchive),
    ]);
    expect(second).toEqual(first);
    expect(archiveEntryModes(firstArchive)).toEqual([
      "drwxr-xr-x ./",
      "-rw-r--r-- ./asset-manifest.json",
      "drwxr-xr-x ./assets/",
      "drwxr-xr-x ./assets/nested/",
      "-rw-r--r-- ./assets/nested/index.html",
      "drwxr-xr-x ./worker/",
      "-rw-r--r-- ./worker/index.js",
    ]);
    expect(archiveEntryModes(secondArchive)).toEqual(
      archiveEntryModes(firstArchive),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Worker archive bytes are independent of absolute checkout paths", async () => {
  const outer = await mkdtemp(join(tmpdir(), "takos-worker-path-test-"));
  const firstRoot = join(outer, "short", "takos");
  const secondRoot = join(
    outer,
    "a-deliberately-different-and-longer-checkout-parent",
    "takos",
  );
  const previousEpoch = process.env.SOURCE_DATE_EPOCH;
  try {
    for (const root of [firstRoot, secondRoot]) {
      await Promise.all([
        mkdir(join(root, "bundle"), { recursive: true }),
        mkdir(join(root, "assets", "nested"), { recursive: true }),
        mkdir(join(root, "images"), { recursive: true }),
      ]);
      await writeFile(
        join(root, "bundle", "index.js"),
        "export default { fetch() { return new Response('ok') } };\n",
      );
      await writeFile(
        join(root, "assets", "nested", "index.html"),
        "<!doctype html><title>Takos</title>\n",
      );
    }

    process.env.SOURCE_DATE_EPOCH = "1700000000";
    await buildWorkerReleaseArtifact({
      bundleDir: join(firstRoot, "bundle"),
      assetsDir: join(firstRoot, "assets"),
      imageDigestDir: join(firstRoot, "images"),
      outputDir: join(firstRoot, "output"),
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });
    process.env.SOURCE_DATE_EPOCH = "1800000000";
    await buildWorkerReleaseArtifact({
      bundleDir: join(secondRoot, "bundle"),
      assetsDir: join(secondRoot, "assets"),
      imageDigestDir: join(secondRoot, "images"),
      outputDir: join(secondRoot, "output"),
      releaseTag: "v1.2.3",
      requireCloudflareContainerImages: false,
    });

    expect(
      await readFile(join(secondRoot, "output", "takos-worker-release.tar.gz")),
    ).toEqual(
      await readFile(join(firstRoot, "output", "takos-worker-release.tar.gz")),
    );
  } finally {
    if (previousEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = previousEpoch;
    await rm(outer, { recursive: true, force: true });
  }
});

function runBuildUnderUmask(
  runner: string,
  mask: string,
  options: Record<string, unknown>,
): void {
  const moduleUrl = pathToFileURL(
    resolve(import.meta.dir, "build-worker-release-artifact.ts"),
  ).href;
  const result = Bun.spawnSync(
    ["bun", runner, mask, moduleUrl, JSON.stringify(options)],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(
    result.exitCode,
    `${result.stdout.toString()}${result.stderr.toString()}`,
  ).toBe(0);
}

function archiveEntryModes(path: string): string[] {
  const result = Bun.spawnSync(
    ["tar", "--list", "--verbose", "--numeric-owner", "--gzip", "--file", path],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.trim().split(/\s+/u);
      return `${fields[0]} ${fields.at(-1)}`;
    });
}
