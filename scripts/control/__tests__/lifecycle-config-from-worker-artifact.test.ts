import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  lifecycleConfigFromWorkerArtifact,
  main,
  parseArgs,
  releaseContainerImagesFromWorkerArtifact,
} from "../lifecycle-config-from-worker-artifact.mjs";

const runtimeRef =
  "registry.cloudflare.com/acc_123/takos-worker-runtime:0.10.0-abcdef123456";
const executorRef =
  "registry.cloudflare.com/acc_123/takos-agent:0.10.0-abcdef123456";

function workerArtifact(overrides: Record<string, unknown> = {}) {
  return {
    kind: "takosumi.worker-artifact@v1",
    app: "takos",
    releaseTag: "v0.10.0",
    artifact: {
      url: "https://github.com/tako0614/takos/releases/download/v0.10.0/takos-worker-release.tar.gz",
      sha256: "a".repeat(64),
    },
    containerImages: { runtime: runtimeRef, executor: executorRef },
    ...overrides,
  };
}

test("extracts validated container images from the worker artifact", () => {
  assert.deepEqual(releaseContainerImagesFromWorkerArtifact(workerArtifact()), {
    runtime: runtimeRef,
    executor: executorRef,
  });
});

test("builds a versioned service-side lifecycle patch", () => {
  const patch = lifecycleConfigFromWorkerArtifact(workerArtifact(), {
    environment: "staging",
    executor: "runner",
    rollout: "gradual",
  });
  assert.equal(patch.kind, "takosumi.install-config-lifecycle-patch@v1");
  assert.equal(patch.lifecycleActions[0]?.phase, "post_apply");
  assert.deepEqual(patch.lifecycleActions[0]?.command, [
    "bun",
    "scripts/control/takosumi-release.mjs",
    "staging",
  ]);
  assert.equal(patch.lifecycleActions[0]?.useProviderCredentials, true);
  assert.equal(
    patch.lifecycleActions[0]?.env?.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
    JSON.stringify({ runtime: runtimeRef, executor: executorRef }),
  );
  assert.deepEqual(patch.lifecycleActionPolicy, {
    allowedExecutors: ["runner"],
    allowedRunnerCapabilities: ["capsule.lifecycle.command.v1"],
    allowProviderCredentials: true,
  });
});

test("fails closed for malformed artifacts and direct option misuse", () => {
  assert.throws(
    () =>
      lifecycleConfigFromWorkerArtifact(
        workerArtifact({ artifact: { url: "http://bad", sha256: "x" } }),
      ),
    /worker artifact URL and SHA-256 are required/u,
  );
  assert.throws(
    () =>
      lifecycleConfigFromWorkerArtifact(workerArtifact(), {
        executor: "unknown",
      }),
    /unsupported lifecycle executor/u,
  );
  assert.throws(
    () =>
      lifecycleConfigFromWorkerArtifact(workerArtifact(), {
        rollout: "unknown",
      }),
    /unsupported container rollout/u,
  );
});

test("parseArgs reads service-side action options", () => {
  assert.deepEqual(
    parseArgs([
      "takosumi-artifact.json",
      "--output",
      "lifecycle.json",
      "--environment",
      "staging",
      "--executor",
      "runner",
      "--rollout",
      "none",
    ]),
    {
      manifestPath: "takosumi-artifact.json",
      output: "lifecycle.json",
      environment: "staging",
      executor: "runner",
      rollout: "none",
      imagesOnly: false,
    },
  );
});

test("main writes an InstallConfig lifecycle patch by default", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "takos-lifecycle-config-"));
  try {
    const manifestPath = resolve(dir, "takosumi-artifact.json");
    const outputPath = resolve(dir, "lifecycle.json");
    writeFileSync(manifestPath, JSON.stringify(workerArtifact()));

    main([manifestPath, "--output", outputPath]);

    const payload = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(payload.kind, "takosumi.install-config-lifecycle-patch@v1");
    assert.equal(payload.lifecycleActions.length, 2);
    assert.equal(payload.release_container_images, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
