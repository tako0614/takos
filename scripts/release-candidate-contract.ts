import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const CANDIDATE_KIND = "takos.release-candidate-manifest@v1";
export const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
export const COMMIT_RE = /^[0-9a-f]{40}$/;

export const REQUIRED_IMAGES = [
  "takos-worker",
  "takos-agent",
  "takos-worker-runtime",
] as const;

export const REQUIRED_RELEASE_ASSETS = [
  "release-manifest.json",
  "install-config-patch.json",
  "takos-worker-release.tar.gz",
  "takos-worker-release.tar.gz.sha256",
  "takosumi-artifact.json",
] as const;

type NamedDigest = {
  name: string;
  path: string;
  digest: string;
};

type ImageDigest = {
  name: string;
  image: string;
  versionRef: string;
  latestRef: string;
  digest: string;
  digestRef: string;
  metadataPath: string;
  sbomPath: string;
  sbomDigest: string;
  provenancePath: string;
  provenanceDigest: string;
  cloudflareRegistryRef?: string;
};

export type CandidateManifest = {
  kind: typeof CANDIDATE_KIND;
  repository: string;
  sourceCommit: string;
  version: string;
  takosumiSourceCommit: string;
  candidateRunId: string;
  builtAt: string;
  ociImages: ImageDigest[];
  releaseAssets: NamedDigest[];
  artifactDigests: string[];
  sbomDigests: string[];
  provenanceDigests: string[];
  configDigest: string;
  policyDigest: string;
  toolchainDigest: string;
};

type BuildInput = {
  repository: string;
  sourceCommit: string;
  version: string;
  takosumiSourceCommit: string;
  candidateRunId: string;
  builtAt?: string;
  imageDigestDir: string;
  releaseManifest: string;
  releaseAssetDir: string;
  policyPath: string;
  toolchainPath: string;
  outputDir: string;
};

type VerifyInput = {
  candidateDir: string;
  repository: string;
  sourceCommit: string;
  version: string;
  takosumiSourceCommit: string;
  candidateRunId: string;
  expectedManifestDigest?: string;
  policyPath: string;
  toolchainPath: string;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function sha256Bytes(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  invariant(
    value !== null && typeof value === "object",
    `${path} must contain a JSON object`,
  );
  return value as Record<string, unknown>;
}

function validateIdentity(input: {
  repository: string;
  sourceCommit: string;
  version: string;
  takosumiSourceCommit: string;
  candidateRunId: string;
}): void {
  invariant(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      input.repository,
    ),
    "repository must be a canonical GitHub HTTPS URL",
  );
  invariant(
    COMMIT_RE.test(input.sourceCommit),
    "sourceCommit must be a full Git SHA",
  );
  invariant(
    COMMIT_RE.test(input.takosumiSourceCommit),
    "takosumiSourceCommit must be a full Git SHA",
  );
  invariant(
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.version),
    "version must be SemVer",
  );
  invariant(
    /^\d+$/.test(input.candidateRunId),
    "candidateRunId must be numeric",
  );
}

function copyAsset(
  source: string,
  outputDir: string,
  name: string,
): NamedDigest {
  const target = join(outputDir, "assets", name);
  mkdirSync(join(outputDir, "assets"), { recursive: true });
  copyFileSync(source, target);
  return { name, path: `assets/${name}`, digest: sha256File(target) };
}

function requireEvidenceJson(path: string, label: string): void {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  invariant(value !== null, `${label} evidence must not be null`);
}

export function buildCandidateManifest(input: BuildInput): CandidateManifest {
  validateIdentity(input);
  const outputDir = resolve(input.outputDir);
  const evidenceDir = join(outputDir, "evidence", "image-digests");
  mkdirSync(evidenceDir, { recursive: true });

  const ociImages = REQUIRED_IMAGES.map((name): ImageDigest => {
    const metadataSource = join(input.imageDigestDir, `${name}.json`);
    const sbomSource = join(input.imageDigestDir, `${name}.sbom.json`);
    const provenanceSource = join(
      input.imageDigestDir,
      `${name}.provenance.json`,
    );
    const metadata = readJson(metadataSource);
    invariant(
      metadata.name === name,
      `${name} metadata has the wrong image name`,
    );
    invariant(
      metadata.commit === input.sourceCommit,
      `${name} metadata source commit drifted`,
    );
    invariant(
      typeof metadata.image === "string",
      `${name} metadata image is missing`,
    );
    invariant(
      typeof metadata.digest === "string" && SHA256_RE.test(metadata.digest),
      `${name} metadata digest is invalid`,
    );
    invariant(
      metadata.digestRef === `${metadata.image}@${metadata.digest}`,
      `${name} digestRef must bind the image content digest`,
    );
    requireEvidenceJson(sbomSource, `${name} SBOM`);
    requireEvidenceJson(provenanceSource, `${name} provenance`);

    for (const source of [metadataSource, sbomSource, provenanceSource]) {
      copyFileSync(source, join(evidenceDir, basename(source)));
    }
    const result: ImageDigest = {
      name,
      image: metadata.image,
      versionRef: `${metadata.image}:${input.version}`,
      latestRef: `${metadata.image}:latest`,
      digest: metadata.digest,
      digestRef: metadata.digestRef as string,
      metadataPath: `evidence/image-digests/${name}.json`,
      sbomPath: `evidence/image-digests/${name}.sbom.json`,
      sbomDigest: sha256File(sbomSource),
      provenancePath: `evidence/image-digests/${name}.provenance.json`,
      provenanceDigest: sha256File(provenanceSource),
    };
    if (typeof metadata.cloudflareRegistryRef === "string") {
      result.cloudflareRegistryRef = metadata.cloudflareRegistryRef;
    }
    return result;
  });

  const releaseAssets = REQUIRED_RELEASE_ASSETS.map((name) => {
    const source =
      name === "release-manifest.json"
        ? input.releaseManifest
        : join(input.releaseAssetDir, name);
    return copyAsset(source, outputDir, name);
  });
  const config = releaseAssets.find(
    (artifact) => artifact.name === "install-config-patch.json",
  );
  invariant(config, "install-config-patch.json is required");

  const manifest: CandidateManifest = {
    kind: CANDIDATE_KIND,
    repository: input.repository,
    sourceCommit: input.sourceCommit,
    version: input.version,
    takosumiSourceCommit: input.takosumiSourceCommit,
    candidateRunId: input.candidateRunId,
    builtAt: input.builtAt ?? new Date().toISOString(),
    ociImages,
    releaseAssets,
    artifactDigests: [
      ...ociImages.map((image) => image.digest),
      ...releaseAssets.map((artifact) => artifact.digest),
    ],
    sbomDigests: ociImages.map((image) => image.sbomDigest),
    provenanceDigests: ociImages.map((image) => image.provenanceDigest),
    configDigest: config.digest,
    policyDigest: sha256File(input.policyPath),
    toolchainDigest: sha256File(input.toolchainPath),
  };
  invariant(
    new Set(manifest.artifactDigests).size === manifest.artifactDigests.length,
    "artifactDigests must be unique",
  );
  writeFileSync(
    join(outputDir, "release-candidate-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  );
  return manifest;
}

export function verifyCandidateManifest(input: VerifyInput): CandidateManifest {
  validateIdentity(input);
  const root = resolve(input.candidateDir);
  const manifestPath = join(root, "release-candidate-manifest.json");
  if (input.expectedManifestDigest) {
    invariant(
      SHA256_RE.test(input.expectedManifestDigest),
      "expectedManifestDigest must be a canonical SHA-256 digest",
    );
    invariant(
      sha256File(manifestPath) === input.expectedManifestDigest,
      "candidate manifest digest drifted",
    );
  }
  const manifest = readJson(manifestPath) as CandidateManifest;
  invariant(
    manifest.kind === CANDIDATE_KIND,
    `kind must equal ${CANDIDATE_KIND}`,
  );
  for (const [field, expected] of Object.entries({
    repository: input.repository,
    sourceCommit: input.sourceCommit,
    version: input.version,
    takosumiSourceCommit: input.takosumiSourceCommit,
    candidateRunId: input.candidateRunId,
  })) {
    invariant(
      manifest[field as keyof CandidateManifest] === expected,
      `${field} drifted`,
    );
  }
  invariant(
    Array.isArray(manifest.ociImages) &&
      manifest.ociImages.map((image) => image.name).join("\n") ===
        REQUIRED_IMAGES.join("\n"),
    "OCI image order or membership drifted",
  );
  invariant(
    Array.isArray(manifest.releaseAssets) &&
      manifest.releaseAssets.map((artifact) => artifact.name).join("\n") ===
        REQUIRED_RELEASE_ASSETS.join("\n"),
    "release asset order or membership drifted",
  );
  for (const image of manifest.ociImages) {
    invariant(SHA256_RE.test(image.digest), `${image.name} digest is invalid`);
    invariant(
      image.digestRef === `${image.image}@${image.digest}`,
      `${image.name} digestRef drifted`,
    );
    invariant(
      image.versionRef === `${image.image}:${input.version}`,
      `${image.name} versionRef drifted`,
    );
    invariant(
      image.latestRef === `${image.image}:latest`,
      `${image.name} latestRef drifted`,
    );
    invariant(
      sha256File(join(root, image.sbomPath)) === image.sbomDigest,
      `${image.name} SBOM drifted`,
    );
    invariant(
      sha256File(join(root, image.provenancePath)) === image.provenanceDigest,
      `${image.name} provenance drifted`,
    );
    const metadata = readJson(join(root, image.metadataPath));
    invariant(
      metadata.digest === image.digest,
      `${image.name} metadata digest drifted`,
    );
    invariant(
      metadata.commit === input.sourceCommit,
      `${image.name} metadata commit drifted`,
    );
  }
  for (const artifact of manifest.releaseAssets) {
    invariant(
      sha256File(join(root, artifact.path)) === artifact.digest,
      `${artifact.name} bytes drifted`,
    );
  }
  const artifactDigests = [
    ...manifest.ociImages.map((image) => image.digest),
    ...manifest.releaseAssets.map((artifact) => artifact.digest),
  ];
  invariant(
    JSON.stringify(manifest.artifactDigests) ===
      JSON.stringify(artifactDigests),
    "ordered artifactDigests drifted",
  );
  invariant(
    JSON.stringify(manifest.sbomDigests) ===
      JSON.stringify(manifest.ociImages.map((image) => image.sbomDigest)),
    "ordered sbomDigests drifted",
  );
  invariant(
    JSON.stringify(manifest.provenanceDigests) ===
      JSON.stringify(manifest.ociImages.map((image) => image.provenanceDigest)),
    "ordered provenanceDigests drifted",
  );
  invariant(
    new Set(artifactDigests).size === artifactDigests.length,
    "artifactDigests must be unique",
  );
  const config = manifest.releaseAssets.find(
    (artifact) => artifact.name === "install-config-patch.json",
  );
  invariant(config?.digest === manifest.configDigest, "configDigest drifted");
  invariant(
    sha256File(input.policyPath) === manifest.policyDigest,
    "policyDigest drifted",
  );
  invariant(
    sha256File(input.toolchainPath) === manifest.toolchainDigest,
    "toolchainDigest drifted",
  );
  return manifest;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  invariant(value, `${name} is required`);
  return value;
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "build") {
    const manifest = buildCandidateManifest({
      repository: argument("--repository"),
      sourceCommit: argument("--source-commit"),
      version: argument("--version"),
      takosumiSourceCommit: argument("--takosumi-source-commit"),
      candidateRunId: argument("--candidate-run-id"),
      imageDigestDir: argument("--image-digest-dir"),
      releaseManifest: argument("--release-manifest"),
      releaseAssetDir: argument("--release-asset-dir"),
      policyPath: argument("--policy"),
      toolchainPath: argument("--toolchain"),
      outputDir: argument("--output-dir"),
    });
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } else if (command === "verify") {
    const manifest = verifyCandidateManifest({
      candidateDir: argument("--candidate-dir"),
      repository: argument("--repository"),
      sourceCommit: argument("--source-commit"),
      version: argument("--version"),
      takosumiSourceCommit: argument("--takosumi-source-commit"),
      candidateRunId: argument("--candidate-run-id"),
      expectedManifestDigest: argument("--manifest-digest"),
      policyPath: argument("--policy"),
      toolchainPath: argument("--toolchain"),
    });
    process.stdout.write(
      `${JSON.stringify({
        kind: "takos.release-candidate-verification@v1",
        status: "verified",
        artifactDigests: manifest.artifactDigests,
        manifestDigest: sha256File(
          join(
            resolve(argument("--candidate-dir")),
            "release-candidate-manifest.json",
          ),
        ),
      })}\n`,
    );
  } else {
    throw new Error(
      "usage: release-candidate-contract.ts <build|verify> [options]",
    );
  }
}
