import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCandidateManifest,
  REQUIRED_IMAGES,
  REQUIRED_RELEASE_ASSETS,
  sha256File,
  verifyCandidateManifest,
} from "../../release-candidate-contract";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "takos-release-candidate-"));
  roots.push(root);
  const images = join(root, "images");
  const release = join(root, "release");
  const output = join(root, "candidate");
  mkdirSync(images);
  mkdirSync(release);
  const sourceCommit = "1".repeat(40);
  const takosumiSourceCommit = "2".repeat(40);
  const candidateRunId = "12345";
  REQUIRED_IMAGES.forEach((name, index) => {
    const digest = `sha256:${String(index + 1).repeat(64)}`;
    writeFileSync(
      join(images, `${name}.json`),
      JSON.stringify({
        name,
        image: `ghcr.io/tako0614/${name}`,
        digest,
        digestRef: `ghcr.io/tako0614/${name}@${digest}`,
        tags: [`ghcr.io/tako0614/${name}:candidate-${candidateRunId}-1`],
        commit: sourceCommit,
        ...(name === "takos-worker"
          ? {}
          : {
              cloudflareRegistryRef: `registry.cloudflare.com/account/${name}:candidate-${candidateRunId}-1`,
            }),
      }),
    );
    writeFileSync(
      join(images, `${name}.sbom.json`),
      JSON.stringify({ name, kind: "sbom" }),
    );
    writeFileSync(
      join(images, `${name}.provenance.json`),
      JSON.stringify({ name, kind: "provenance" }),
    );
  });
  const releaseManifest = join(root, "release-manifest.json");
  writeFileSync(releaseManifest, JSON.stringify({ schemaVersion: 1 }));
  for (const name of REQUIRED_RELEASE_ASSETS.filter(
    (name) => name !== "release-manifest.json",
  )) {
    writeFileSync(join(release, name), `bytes:${name}`);
  }
  const policyPath = join(root, "policy.yml");
  const toolchainPath = join(root, "bun.lock");
  writeFileSync(policyPath, "policy");
  writeFileSync(toolchainPath, "toolchain");
  return {
    root,
    images,
    release,
    output,
    sourceCommit,
    takosumiSourceCommit,
    candidateRunId,
    releaseManifest,
    policyPath,
    toolchainPath,
  };
}

describe("release candidate contract", () => {
  test("builds and verifies one ordered immutable digest set", () => {
    const input = fixture();
    const manifest = buildCandidateManifest({
      repository: "https://github.com/tako0614/takos.git",
      sourceCommit: input.sourceCommit,
      version: "0.10.36",
      takosumiSourceCommit: input.takosumiSourceCommit,
      candidateRunId: input.candidateRunId,
      builtAt: "2026-07-19T00:00:00.000Z",
      imageDigestDir: input.images,
      releaseManifest: input.releaseManifest,
      releaseAssetDir: input.release,
      policyPath: input.policyPath,
      toolchainPath: input.toolchainPath,
      outputDir: input.output,
    });

    expect(manifest.artifactDigests).toHaveLength(8);
    expect(manifest.ociImages.map((image) => image.name)).toEqual(
      REQUIRED_IMAGES,
    );
    expect(manifest.releaseAssets.map((asset) => asset.name)).toEqual(
      REQUIRED_RELEASE_ASSETS,
    );
    expect(Object.keys(manifest).sort()).toEqual(
      [
        "kind",
        "surfaceId",
        "repository",
        "sourceCommit",
        "version",
        "tag",
        "workflowRunId",
        "builtAt",
        "ociImages",
        "releaseAssets",
        "artifactDigests",
        "sbomDigests",
        "provenanceDigests",
        "configDigest",
        "policyDigest",
        "toolchainDigest",
      ].sort(),
    );
    expect(Object.keys(manifest.ociImages[0]).sort()).toEqual(
      ["name", "versionRef", "latestRef", "digest"].sort(),
    );
    expect(Object.keys(manifest.releaseAssets[0]).sort()).toEqual(
      ["name", "digest"].sort(),
    );
    expect(
      verifyCandidateManifest({
        candidateDir: input.output,
        repository: manifest.repository,
        sourceCommit: manifest.sourceCommit,
        version: manifest.version,
        takosumiSourceCommit: input.takosumiSourceCommit,
        candidateRunId: manifest.workflowRunId,
        expectedManifestDigest: sha256File(
          join(input.output, "release-candidate-manifest.json"),
        ),
        policyPath: input.policyPath,
        toolchainPath: input.toolchainPath,
      }).artifactDigests,
    ).toEqual(manifest.artifactDigests);
  });

  test("fails closed when a candidate byte drifts", () => {
    const input = fixture();
    const manifest = buildCandidateManifest({
      repository: "https://github.com/tako0614/takos.git",
      sourceCommit: input.sourceCommit,
      version: "0.10.36",
      takosumiSourceCommit: input.takosumiSourceCommit,
      candidateRunId: input.candidateRunId,
      imageDigestDir: input.images,
      releaseManifest: input.releaseManifest,
      releaseAssetDir: input.release,
      policyPath: input.policyPath,
      toolchainPath: input.toolchainPath,
      outputDir: input.output,
    });
    writeFileSync(
      join(input.output, "assets", "takosumi-artifact.json"),
      "drift",
    );
    expect(() =>
      verifyCandidateManifest({
        candidateDir: input.output,
        repository: manifest.repository,
        sourceCommit: manifest.sourceCommit,
        version: manifest.version,
        takosumiSourceCommit: input.takosumiSourceCommit,
        candidateRunId: manifest.workflowRunId,
        expectedManifestDigest: sha256File(
          join(input.output, "release-candidate-manifest.json"),
        ),
        policyPath: input.policyPath,
        toolchainPath: input.toolchainPath,
      }),
    ).toThrow("takosumi-artifact.json bytes drifted");
  });

  test("fails closed when candidate metadata points at another OCI repository", () => {
    const input = fixture();
    const metadataPath = join(input.images, "takos-worker.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.image = "ghcr.io/tako0614/another-image";
    metadata.digestRef = `${metadata.image}@${metadata.digest}`;
    metadata.tags = [`${metadata.image}:candidate-${input.candidateRunId}-1`];
    writeFileSync(metadataPath, JSON.stringify(metadata));

    expect(() =>
      buildCandidateManifest({
        repository: "https://github.com/tako0614/takos.git",
        sourceCommit: input.sourceCommit,
        version: "0.10.36",
        takosumiSourceCommit: input.takosumiSourceCommit,
        candidateRunId: input.candidateRunId,
        imageDigestDir: input.images,
        releaseManifest: input.releaseManifest,
        releaseAssetDir: input.release,
        policyPath: input.policyPath,
        toolchainPath: input.toolchainPath,
        outputDir: input.output,
      }),
    ).toThrow("takos-worker metadata image drifted");
  });
});
