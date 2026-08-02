import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  type CandidateManifest,
  sha256File,
} from "./release-candidate-contract.ts";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

type ActivationResult = {
  readonly environment: string;
  readonly operation: string;
  readonly status: string;
  readonly workerArtifact?: { readonly sha256?: string; readonly sizeBytes?: number };
  readonly activation: {
    readonly deployment?: { readonly skipped?: boolean; readonly status?: unknown };
    readonly containers?: {
      readonly skipped?: boolean;
      readonly containers: readonly {
        readonly className: string;
        readonly image: string;
      }[];
    };
    readonly workerContent?: {
      readonly workerName?: string;
      readonly bytes?: number;
      readonly sha256?: string;
      readonly skipped?: boolean;
      readonly reason?: string;
    };
    readonly health?: {
      readonly skipped?: boolean;
      readonly url?: string;
      readonly status: number;
    };
  };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  invariant(value, `${name} is required`);
  return value;
}

function gitValue(directory: string, args: string[]): string {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  });
  invariant(result.status === 0, `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function cleanGitCheckoutCommit(
  directory: string,
  label: string,
): string {
  const commit = gitValue(directory, ["rev-parse", "HEAD"]);
  invariant(COMMIT_RE.test(commit), `${label} HEAD is not a full commit`);
  invariant(
    gitValue(directory, ["status", "--porcelain"]) === "",
    `${label} checkout must be clean`,
  );
  return commit;
}

type StagingContainerSelection = {
  readonly descriptorDigest: string;
  readonly runtime: {
    readonly registryRef: string;
    readonly sourceDigest: string;
  };
  readonly executor: {
    readonly registryRef: string;
    readonly sourceDigest: string;
  };
};

function record(value: unknown, label: string): Record<string, unknown> {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}

function candidateImageDigest(
  manifest: CandidateManifest,
  name: "takos-worker-runtime" | "takos-agent",
): string {
  const digest = manifest.ociImages.find(
    (image) => image.name === name,
  )?.digest;
  invariant(
    typeof digest === "string" && SHA256_RE.test(digest),
    `candidate ${name} OCI digest is missing`,
  );
  return digest;
}

function candidateRegistryRef(
  manifest: CandidateManifest,
  value: unknown,
  image: "takos-worker-runtime" | "takos-agent",
): string {
  invariant(
    typeof value === "string",
    `candidate ${image} registry ref is missing`,
  );
  const sealed = manifest.ociImages.find((entry) => entry.name === image);
  invariant(
    sealed?.cloudflareRegistryRef === value &&
      /^registry\.cloudflare\.com\/[^/]+\/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(
        value,
      ) &&
      sealed.cloudflareRegistryDigest &&
      value.endsWith(`@${sealed.cloudflareRegistryDigest}`),
    `candidate ${image} Cloudflare digest ref drifted`,
  );
  return value;
}

export function sealedStagingContainerSelection(input: {
  candidateDir: string;
  manifest: CandidateManifest;
}): StagingContainerSelection {
  const candidateDir = resolve(input.candidateDir);
  const descriptorAsset = input.manifest.releaseAssets.find(
    (asset) => asset.name === "takosumi-artifact.json",
  );
  invariant(
    descriptorAsset && SHA256_RE.test(descriptorAsset.digest),
    "candidate Worker artifact descriptor is missing",
  );
  const descriptorPath = join(candidateDir, "assets", descriptorAsset.name);
  invariant(
    existsSync(descriptorPath) && lstatSync(descriptorPath).isFile(),
    "candidate Worker artifact descriptor must be a regular non-symlink file",
  );
  invariant(
    sha256File(descriptorPath) === descriptorAsset.digest,
    "candidate Worker artifact descriptor digest drifted",
  );
  const descriptor = record(
    JSON.parse(readFileSync(descriptorPath, "utf8")) as unknown,
    "candidate Worker artifact descriptor",
  );
  invariant(
    descriptor.kind === "takosumi.worker-artifact@v1" &&
      descriptor.app === "takos" &&
      descriptor.commit === input.manifest.sourceCommit &&
      descriptor.releaseTag === input.manifest.tag &&
      descriptor.workflowRun ===
        `https://github.com/tako0614/takos/actions/runs/${input.manifest.workflowRunId}`,
    "candidate Worker artifact descriptor identity drifted",
  );
  const archive = input.manifest.releaseAssets.find(
    (asset) => asset.name === "takos-worker-release.tar.gz",
  );
  invariant(archive, "candidate Worker archive is missing");
  const descriptorArchive = record(
    descriptor.artifact,
    "candidate Worker archive descriptor",
  );
  invariant(
    descriptorArchive.filename === archive.name &&
      descriptorArchive.sha256Prefixed === archive.digest &&
      descriptorArchive.sha256 === archive.digest.slice("sha256:".length),
    "candidate Worker archive descriptor drifted",
  );
  const containerImages = record(
    descriptor.containerImages,
    "candidate container image selection",
  );
  const runtimeRef = candidateRegistryRef(
    input.manifest,
    containerImages.runtime,
    "takos-worker-runtime",
  );
  const executorRef = candidateRegistryRef(
    input.manifest,
    containerImages.executor,
    "takos-agent",
  );
  invariant(
    runtimeRef.split("/")[1] === executorRef.split("/")[1],
    "candidate container registry accounts drifted",
  );
  return {
    descriptorDigest: descriptorAsset.digest,
    runtime: {
      registryRef: runtimeRef,
      sourceDigest: candidateImageDigest(
        input.manifest,
        "takos-worker-runtime",
      ),
    },
    executor: {
      registryRef: executorRef,
      sourceDigest: candidateImageDigest(input.manifest, "takos-agent"),
    },
  };
}

export function buildStagingActivationEnv(input: {
  candidateDir: string;
  manifest: CandidateManifest;
  baseEnv?: Record<string, string | undefined>;
}): Record<string, string | undefined> {
  const candidateDir = resolve(input.candidateDir);
  const archive = input.manifest.releaseAssets.find(
    (asset) => asset.name === "takos-worker-release.tar.gz",
  );
  invariant(archive, "candidate Worker archive is missing");
  const containers = sealedStagingContainerSelection({
    candidateDir,
    manifest: input.manifest,
  });
  return {
    ...input.baseEnv,
    TAKOS_RELEASE_WORKER_ARTIFACT_URL: undefined,
    TAKOS_RELEASE_WORKER_ARTIFACT_FILE: join(
      candidateDir,
      "assets",
      archive.name,
    ),
    TAKOS_RELEASE_WORKER_ARTIFACT_SHA256: archive.digest.slice(
      "sha256:".length,
    ),
    TAKOS_RELEASE_CONTAINER_IMAGES_JSON: JSON.stringify({
      runtime: containers.runtime.registryRef,
      executor: containers.executor.registryRef,
    }),
    TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES: "true",
    TAKOS_RELEASE_REQUIRE_WRANGLER_DEPLOYMENT_STATUS: "true",
  };
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildStagingEvidence(input: {
  releaseId: string;
  controllerCommit: string;
  manifest: CandidateManifest;
  manifestDigest: string;
  containers: StagingContainerSelection;
  activation: ActivationResult;
  verifiedAt?: string;
}) {
  const { activation } = input;
  invariant(
    activation.environment === "staging" && activation.operation === "activate",
    "staging activation identity drifted",
  );
  invariant(activation.status === "succeeded", "staging activation failed");
  invariant(
    activation.workerArtifact?.sha256 &&
      `sha256:${activation.workerArtifact.sha256}` ===
        input.manifest.releaseAssets.find(
          (asset) => asset.name === "takos-worker-release.tar.gz",
        )?.digest,
    "activated Worker archive digest drifted",
  );
  invariant(
    activation.activation.deployment?.skipped === false,
    "persistent staging deployment readback was skipped",
  );
  invariant(
    activation.activation.containers?.skipped === false,
    "persistent staging container readback was skipped or incomplete",
  );
  const observedContainers = new Map(
    activation.activation.containers.containers.map((container) => [
      container.className,
      container.image,
    ]),
  );
  invariant(
    activation.activation.containers.containers.length === 4 &&
      observedContainers.size === 4 &&
      observedContainers.get("TakosRuntimeContainer") ===
        input.containers.runtime.registryRef &&
      [
        "ExecutorContainerTier1",
        "ExecutorContainerTier2",
        "ExecutorContainerTier3",
      ].every(
        (className) =>
          observedContainers.get(className) ===
          input.containers.executor.registryRef,
      ),
    "persistent staging container selection drifted",
  );
  invariant(
    activation.activation.workerContent?.skipped !== true &&
      SHA256_RE.test(`sha256:${activation.activation.workerContent?.sha256}`),
    "persistent staging Worker content readback was skipped",
  );
  invariant(
    activation.activation.health?.skipped === false &&
      activation.activation.health.status >= 200 &&
      activation.activation.health.status < 300,
    "persistent staging health verification was skipped or failed",
  );
  const activationBinding = digestJson(activation);
  return {
    kind: "takos.release-staging-qualification@v1",
    status: "verified",
    releaseId: input.releaseId,
    environment: "staging",
    sourceCommit: input.manifest.sourceCommit,
    controllerCommit: input.controllerCommit,
    candidateRunId: input.manifest.workflowRunId,
    candidateManifestDigest: input.manifestDigest,
    artifactDigests: input.manifest.artifactDigests,
    containerImageSelection: input.containers,
    activation,
    checks: [
      {
        name: "sealed candidate manifest and source",
        status: "passed",
        bindingDigest: input.manifestDigest,
      },
      {
        name: "exact Worker archive and sealed candidate container selection",
        status: "passed",
        bindingDigest: activationBinding,
      },
      {
        name: "persistent staging readback and health",
        status: "passed",
        bindingDigest: digestJson({
          workerContent: activation.activation.workerContent,
          health: activation.activation.health,
        }),
      },
    ],
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
  } as const;
}

export function writePrivateEvidence(
  outputPath: string,
  evidence: unknown,
): void {
  const output = resolve(outputPath);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  invariant(
    lstatSync(parent).isDirectory() && realpathSync(parent) === parent,
    "staging evidence directory must be a real directory without symlinks",
  );
  invariant(!existsSync(output), "staging evidence output already exists");
  const temporary = join(
    parent,
    `.${basename(output)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    // Hard-link publication is atomic and fails with EEXIST. Unlike rename(),
    // it cannot replace an output (or symlink) created after the preflight.
    linkSync(temporary, output);
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (import.meta.main) {
  throw new Error(
    "Direct staging qualification is retired. Use the takos-ecosystem release-safety stage controller and its registered managed adapter.",
  );
}
