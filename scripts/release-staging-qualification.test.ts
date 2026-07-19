import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CandidateManifest } from "./release-candidate-contract.ts";
import {
  buildStagingActivationEnv,
  buildStagingEvidence,
} from "./release-staging-qualification.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const manifest = {
  sourceCommit: "a".repeat(40),
  workflowRunId: "12345",
  artifactDigests: [digest("1"), digest("2")],
  releaseAssets: [{ name: "takos-worker-release.tar.gz", digest: digest("2") }],
} as CandidateManifest;

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
        { className: "TakosRuntimeContainer", image: "runtime" },
        { className: "ExecutorContainerTier1", image: "agent" },
        { className: "ExecutorContainerTier2", image: "agent" },
        { className: "ExecutorContainerTier3", image: "agent" },
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
      activation: {
        ...activation,
        activation: {
          ...activation.activation,
          containers: { skipped: true, reason: "not checked" },
        },
      },
    }),
  ).toThrow(/container readback was skipped or incomplete/u);
});

test("staging activation consumes sealed local bytes and candidate-only container refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-staging-qualification-"));
  try {
    const metadataDir = join(root, "evidence", "image-digests");
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(metadataDir, { recursive: true });
    await writeFile(
      join(metadataDir, "takos-worker-runtime.json"),
      JSON.stringify({
        cloudflareRegistryRef:
          "registry.cloudflare.com/acc/takos-worker-runtime:candidate-12345-1",
      }),
    );
    await writeFile(
      join(metadataDir, "takos-agent.json"),
      JSON.stringify({
        cloudflareRegistryRef:
          "registry.cloudflare.com/acc/takos-agent:candidate-12345-1",
      }),
    );
    const env = buildStagingActivationEnv({
      candidateDir: root,
      manifest,
      baseEnv: { TAKOS_RELEASE_WORKER_ARTIFACT_URL: "https://mutable.invalid" },
    });
    expect(env.TAKOS_RELEASE_WORKER_ARTIFACT_URL).toBeUndefined();
    expect(env.TAKOS_RELEASE_WORKER_ARTIFACT_FILE).toBe(
      join(root, "assets", "takos-worker-release.tar.gz"),
    );
    expect(env.TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES).toBe("true");
    expect(JSON.parse(env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON ?? "{}")).toEqual(
      {
        runtime:
          "registry.cloudflare.com/acc/takos-worker-runtime:candidate-12345-1",
        executor: "registry.cloudflare.com/acc/takos-agent:candidate-12345-1",
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
