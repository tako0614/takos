import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CandidateManifest } from "./release-candidate-contract.ts";
import {
  buildStagingActivationEnv,
  buildStagingEvidence,
  writePrivateEvidence,
} from "./release-staging-qualification.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const runtimeRef = `registry.cloudflare.com/acc/takos-worker-runtime@${digest("7")}`;
const executorRef = `registry.cloudflare.com/acc/takos-agent@${digest("6")}`;

const manifest = {
  sourceCommit: "a".repeat(40),
  version: "0.10.37",
  tag: "v0.10.37",
  workflowRunId: "12345",
  ociImages: [
    {
      name: "takos-agent",
      digest: digest("6"),
      cloudflareRegistryRef: executorRef,
      cloudflareRegistryTagRef:
        "registry.cloudflare.com/acc/takos-agent:candidate-12345-1",
      cloudflareRegistryDigest: digest("6"),
    },
    {
      name: "takos-worker-runtime",
      digest: digest("7"),
      cloudflareRegistryRef: runtimeRef,
      cloudflareRegistryTagRef:
        "registry.cloudflare.com/acc/takos-worker-runtime:candidate-12345-1",
      cloudflareRegistryDigest: digest("7"),
    },
  ],
  artifactDigests: [digest("6"), digest("7"), digest("2"), digest("5")],
  releaseAssets: [
    { name: "takos-worker-release.tar.gz", digest: digest("2") },
    { name: "takosumi-artifact.json", digest: digest("5") },
  ],
} as CandidateManifest;

const containers = {
  descriptorDigest: digest("5"),
  runtime: { registryRef: runtimeRef, sourceDigest: digest("7") },
  executor: { registryRef: executorRef, sourceDigest: digest("6") },
};

const activation = {
  environment: "staging",
  operation: "activate",
  status: "succeeded",
  workerArtifact: { sha256: "2".repeat(64), sizeBytes: 123 },
  activation: {
    deployment: { skipped: false, status: { id: "deployment-1" } },
    containers: {
      skipped: false,
      containers: [
        { className: "TakosRuntimeContainer", image: runtimeRef },
        { className: "ExecutorContainerTier1", image: executorRef },
        { className: "ExecutorContainerTier2", image: executorRef },
        { className: "ExecutorContainerTier3", image: executorRef },
      ],
    },
    workerContent: {
      workerName: "takos-staging",
      bytes: 4096,
      sha256: "3".repeat(64),
    },
    health: {
      skipped: false,
      url: "https://takos-staging.example/health",
      status: 200,
    },
  },
};

test("staging evidence fails closed and binds exact activation readback", () => {
  const evidence = buildStagingEvidence({
    releaseId: "takos-release-artifacts-0.10.37-attempt-1",
    controllerCommit: "b".repeat(40),
    manifest,
    manifestDigest: digest("4"),
    containers,
    activation,
    verifiedAt: "2026-07-19T15:00:00.000Z",
  });
  expect(evidence.status).toBe("verified");
  expect(evidence.artifactDigests).toEqual(manifest.artifactDigests);
  expect(evidence.checks).toHaveLength(3);
  expect(
    evidence.checks.every((check) =>
      /^sha256:[0-9a-f]{64}$/.test(check.bindingDigest),
    ),
  ).toBe(true);
  expect(() =>
    buildStagingEvidence({
      releaseId: evidence.releaseId,
      controllerCommit: "b".repeat(40),
      manifest,
      manifestDigest: digest("4"),
      containers,
      activation: {
        ...activation,
        activation: {
          ...activation.activation,
          containers: { skipped: true, reason: "not checked" },
        },
      },
    }),
  ).toThrow(/container readback was skipped or incomplete/u);
  expect(() =>
    buildStagingEvidence({
      releaseId: evidence.releaseId,
      controllerCommit: "b".repeat(40),
      manifest,
      manifestDigest: digest("4"),
      containers,
      activation: {
        ...activation,
        activation: {
          ...activation.activation,
          workerContent: {
            workerName: "takos-staging",
            skipped: true,
            reason: "content_api_unavailable",
          },
        },
      },
    }),
  ).toThrow(/Worker content readback was skipped/u);
});

test("staging activation consumes sealed local bytes and candidate-only container refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-staging-qualification-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    const descriptor = JSON.stringify({
      kind: "takosumi.worker-artifact@v1",
      app: "takos",
      commit: manifest.sourceCommit,
      releaseTag: manifest.tag,
      workflowRun: "https://github.com/tako0614/takos/actions/runs/12345",
      artifact: {
        filename: "takos-worker-release.tar.gz",
        sha256: "2".repeat(64),
        sha256Prefixed: digest("2"),
      },
      containerImages: { runtime: runtimeRef, executor: executorRef },
    });
    await writeFile(join(root, "assets", "takosumi-artifact.json"), descriptor);
    const descriptorDigest = `sha256:${createHash("sha256").update(descriptor).digest("hex")}`;
    const sealedManifest = {
      ...manifest,
      releaseAssets: manifest.releaseAssets.map((asset) =>
        asset.name === "takosumi-artifact.json"
          ? { ...asset, digest: descriptorDigest }
          : asset,
      ),
    };
    const env = buildStagingActivationEnv({
      candidateDir: root,
      manifest: sealedManifest,
      baseEnv: { TAKOS_RELEASE_WORKER_ARTIFACT_URL: "https://mutable.invalid" },
    });
    expect(env.TAKOS_RELEASE_WORKER_ARTIFACT_URL).toBeUndefined();
    expect(env.TAKOS_RELEASE_WORKER_ARTIFACT_FILE).toBe(
      join(root, "assets", "takos-worker-release.tar.gz"),
    );
    expect(env.TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES).toBe("true");
    expect(JSON.parse(env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON ?? "{}")).toEqual(
      {
        runtime: runtimeRef,
        executor: executorRef,
      },
    );
    await mkdir(join(root, "evidence", "image-digests"), { recursive: true });
    await writeFile(
      join(root, "evidence", "image-digests", "takos-worker-runtime.json"),
      JSON.stringify({
        cloudflareRegistryRef:
          "registry.cloudflare.com/attacker/takos-worker-runtime:candidate-12345-1",
      }),
    );
    expect(
      JSON.parse(
        buildStagingActivationEnv({
          candidateDir: root,
          manifest: sealedManifest,
        }).TAKOS_RELEASE_CONTAINER_IMAGES_JSON ?? "{}",
      ).runtime,
    ).toBe(runtimeRef);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private staging evidence writes atomically without chmodding an existing parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-staging-evidence-"));
  try {
    await chmod(root, 0o755);
    const output = join(root, "qualification.json");
    writePrivateEvidence(output, { status: "verified" });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({
      status: "verified",
    });
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect((await stat(root)).mode & 0o777).toBe(0o755);
    expect(() => writePrivateEvidence(output, { status: "replaced" })).toThrow(
      /already exists/u,
    );
    const linked = join(root, "linked.json");
    await symlink(output, linked);
    expect(() => writePrivateEvidence(linked, { status: "replaced" })).toThrow(
      /already exists/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
