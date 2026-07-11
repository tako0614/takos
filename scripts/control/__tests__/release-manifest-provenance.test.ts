import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const imageNames = [
  "takos-worker",
  "takos-agent",
  "takos-worker-runtime",
] as const;

test("release manifest records the package version source and pinned agent engine SHA", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "takos-release-provenance-"));
  try {
    const imageDir = resolve(root, "images");
    const output = resolve(root, "release-manifest.json");
    await writeImageRecords(imageDir);
    const result = await runManifest(imageDir, output);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(await readFile(output, "utf8"));
    const packageConfig = JSON.parse(
      await readFile(resolve(repoRoot, "package.json"), "utf8"),
    );
    const engineSource = JSON.parse(
      await readFile(
        resolve(repoRoot, "containers/agent/engine-source.json"),
        "utf8",
      ),
    );
    expect(manifest.release.version).toBe(packageConfig.takosRelease.version);
    expect(manifest.sourceProvenance.releaseVersion).toEqual({
      source: "package.json#takosRelease.version",
      value: packageConfig.takosRelease.version,
    });
    expect(manifest.sourceProvenance.agentEngine).toEqual({
      repository: engineSource.repository,
      commit: engineSource.commit,
      pin: "containers/agent/engine-source.json",
    });
    const agentImage = manifest.officialImages.images.find(
      (image: { name: string }) => image.name === "takos-agent",
    );
    expect(agentImage.sourceCommits.agentEngine).toBe(engineSource.commit);
    expect(manifest.officialImages.complete).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest rejects agent image provenance from another engine commit", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "takos-release-engine-drift-"));
  try {
    const imageDir = resolve(root, "images");
    const output = resolve(root, "release-manifest.json");
    await writeImageRecords(imageDir, "0".repeat(40));
    const result = await runManifest(imageDir, output);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "takos-agent: agentEngineCommit must match",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeImageRecords(
  imageDir: string,
  agentEngineCommitOverride?: string,
): Promise<void> {
  await mkdir(imageDir, { recursive: true });
  const packageConfig = JSON.parse(
    await readFile(resolve(repoRoot, "package.json"), "utf8"),
  );
  const engineSource = JSON.parse(
    await readFile(
      resolve(repoRoot, "containers/agent/engine-source.json"),
      "utf8",
    ),
  );
  const commit = commandText(["git", "rev-parse", "HEAD"]);
  const remote = commandText(["git", "config", "--get", "remote.origin.url"]);
  const owner =
    /^https:\/\/github\.com\/([^/]+)\//u.exec(remote)?.[1] ??
    /^git@github\.com:([^/]+)\//u.exec(remote)?.[1] ??
    "tako0614";

  for (const [index, name] of imageNames.entries()) {
    const repository = `ghcr.io/${owner}/${name}`;
    const digest = `sha256:${String(index + 1).repeat(64)}`;
    await writeFile(
      resolve(imageDir, `${name}.json`),
      `${JSON.stringify(
        {
          name,
          image: repository,
          digest,
          digestRef: `${repository}@${digest}`,
          tags: [
            `${repository}:${packageConfig.takosRelease.version}`,
            `${repository}:sha-${commit.slice(0, 7)}`,
          ],
          commit,
          ...(name === "takos-agent"
            ? {
                agentEngineCommit:
                  agentEngineCommitOverride ?? engineSource.commit,
              }
            : {}),
          sbom: true,
          provenance: true,
        },
        null,
        2,
      )}\n`,
    );
  }
}

async function runManifest(imageDir: string, output: string) {
  const process = Bun.spawn(
    [
      "bun",
      "scripts/build-release-manifest.ts",
      "--image-digest-dir",
      imageDir,
      "--require-image-digests",
      "--output",
      output,
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

function commandText(command: string[]): string {
  const result = Bun.spawnSync(command, { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}
