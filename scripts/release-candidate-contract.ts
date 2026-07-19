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
  digest: string;
};

type ImageDigest = {
  name: string;
  versionRef: string;
  latestRef: string;
  digest: string;
};

export type CandidateManifest = {
  kind: typeof CANDIDATE_KIND;
  surfaceId: "takos-release-artifacts";
  repository: string;
  sourceCommit: string;
  version: string;
  tag: string;
  workflowRunId: string;
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
  return { name, digest: sha256File(target) };
}

function requireEvidenceJson(path: string, label: string): void {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  invariant(value !== null, `${label} evidence must not be null`);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} keys drifted`,
  );
}

export function buildCandidateManifest(input: BuildInput): CandidateManifest {
  validateIdentity(input);
  const outputDir = resolve(input.outputDir);
  const evidenceDir = join(outputDir, "evidence", "image-digests");
  mkdirSync(evidenceDir, { recursive: true });

  const imageEvidence = REQUIRED_IMAGES.map((name) => {
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
      metadata.image === `ghcr.io/tako0614/${name}`,
      `${name} metadata image drifted`,
    );
    invariant(
      typeof metadata.digest === "string" && SHA256_RE.test(metadata.digest),
      `${name} metadata digest is invalid`,
    );
    invariant(
      metadata.digestRef === `${metadata.image}@${metadata.digest}`,
      `${name} digestRef must bind the image content digest`,
    );
    invariant(
      JSON.stringify(metadata.tags) ===
        JSON.stringify([
          `${metadata.image}:candidate-${input.candidateRunId}-1`,
        ]),
      `${name} metadata must contain only the exact candidate tag`,
    );
    if (name !== "takos-worker") {
      invariant(
        typeof metadata.cloudflareRegistryRef === "string" &&
          metadata.cloudflareRegistryRef.endsWith(
            `/${name}:candidate-${input.candidateRunId}-1`,
          ),
        `${name} Cloudflare registry candidate ref is required`,
      );
    }
    requireEvidenceJson(sbomSource, `${name} SBOM`);
    requireEvidenceJson(provenanceSource, `${name} provenance`);

    for (const source of [metadataSource, sbomSource, provenanceSource]) {
      copyFileSync(source, join(evidenceDir, basename(source)));
    }
    return {
      image: {
        name,
        versionRef: `${metadata.image}:${input.version}`,
        latestRef: `${metadata.image}:latest`,
        digest: metadata.digest,
      } satisfies ImageDigest,
      sbomDigest: sha256File(sbomSource),
      provenanceDigest: sha256File(provenanceSource),
    };
  });
  const ociImages = imageEvidence.map((evidence) => evidence.image);

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
    surfaceId: "takos-release-artifacts",
    repository: input.repository,
    sourceCommit: input.sourceCommit,
    version: input.version,
    tag: `v${input.version}`,
    workflowRunId: input.candidateRunId,
    builtAt: input.builtAt ?? new Date().toISOString(),
    ociImages,
    releaseAssets,
    artifactDigests: [
      ...ociImages.map((image) => image.digest),
      ...releaseAssets.map((artifact) => artifact.digest),
    ],
    sbomDigests: imageEvidence.map((evidence) => evidence.sbomDigest),
    provenanceDigests: imageEvidence.map(
      (evidence) => evidence.provenanceDigest,
    ),
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
  const manifestRecord = readJson(manifestPath);
  requireExactKeys(
    manifestRecord,
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
    ],
    "candidate manifest",
  );
  const manifest = manifestRecord as CandidateManifest;
  invariant(
    manifest.kind === CANDIDATE_KIND,
    `kind must equal ${CANDIDATE_KIND}`,
  );
  for (const [field, expected] of Object.entries({
    surfaceId: "takos-release-artifacts",
    repository: input.repository,
    sourceCommit: input.sourceCommit,
    version: input.version,
    tag: `v${input.version}`,
    workflowRunId: input.candidateRunId,
  })) {
    invariant(
      manifest[field as keyof CandidateManifest] === expected,
      `${field} drifted`,
    );
  }
  invariant(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.builtAt) &&
      Number.isFinite(Date.parse(manifest.builtAt)),
    "builtAt drifted",
  );
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
  for (const [index, image] of manifest.ociImages.entries()) {
    requireExactKeys(
      image as unknown as Record<string, unknown>,
      ["name", "versionRef", "latestRef", "digest"],
      `${image.name} image`,
    );
    invariant(SHA256_RE.test(image.digest), `${image.name} digest is invalid`);
    const expectedImage = `ghcr.io/tako0614/${image.name}`;
    invariant(
      image.versionRef === `${expectedImage}:${input.version}`,
      `${image.name} versionRef drifted`,
    );
    invariant(
      image.latestRef === `${expectedImage}:latest`,
      `${image.name} latestRef drifted`,
    );
    const sbomPath = join(
      root,
      "evidence",
      "image-digests",
      `${image.name}.sbom.json`,
    );
    const provenancePath = join(
      root,
      "evidence",
      "image-digests",
      `${image.name}.provenance.json`,
    );
    invariant(
      sha256File(sbomPath) === manifest.sbomDigests[index],
      `${image.name} SBOM drifted`,
    );
    invariant(
      sha256File(provenancePath) === manifest.provenanceDigests[index],
      `${image.name} provenance drifted`,
    );
    const metadata = readJson(
      join(root, "evidence", "image-digests", `${image.name}.json`),
    );
    invariant(
      metadata.image === expectedImage,
      `${image.name} metadata image drifted`,
    );
    invariant(
      metadata.digest === image.digest,
      `${image.name} metadata digest drifted`,
    );
    invariant(
      metadata.commit === input.sourceCommit,
      `${image.name} metadata commit drifted`,
    );
    invariant(
      metadata.digestRef === `${expectedImage}@${image.digest}`,
      `${image.name} metadata digestRef drifted`,
    );
    invariant(
      JSON.stringify(metadata.tags) ===
        JSON.stringify([
          `${expectedImage}:candidate-${input.candidateRunId}-1`,
        ]),
      `${image.name} metadata candidate tag drifted`,
    );
    if (image.name !== "takos-worker") {
      invariant(
        typeof metadata.cloudflareRegistryRef === "string" &&
          metadata.cloudflareRegistryRef.endsWith(
            `/${image.name}:candidate-${input.candidateRunId}-1`,
          ),
        `${image.name} Cloudflare registry candidate ref drifted`,
      );
    }
  }
  for (const artifact of manifest.releaseAssets) {
    requireExactKeys(
      artifact as unknown as Record<string, unknown>,
      ["name", "digest"],
      `${artifact.name} release asset`,
    );
    invariant(
      sha256File(join(root, "assets", artifact.name)) === artifact.digest,
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
      JSON.stringify(
        manifest.ociImages.map((image) =>
          sha256File(
            join(root, "evidence", "image-digests", `${image.name}.sbom.json`),
          ),
        ),
      ),
    "ordered sbomDigests drifted",
  );
  invariant(
    JSON.stringify(manifest.provenanceDigests) ===
      JSON.stringify(
        manifest.ociImages.map((image) =>
          sha256File(
            join(
              root,
              "evidence",
              "image-digests",
              `${image.name}.provenance.json`,
            ),
          ),
        ),
      ),
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
