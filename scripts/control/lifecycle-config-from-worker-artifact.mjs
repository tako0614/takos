#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { normalizeReleaseContainerImages } from "./takosumi-release.mjs";

const LIFECYCLE_CAPABILITY = "capsule.lifecycle.command.v1";

function usage() {
  console.error(
    [
      "Usage: bun scripts/control/lifecycle-config-from-worker-artifact.mjs <takosumi-artifact.json> [--output <path>] [--environment <name>] [--executor runner|operator] [--rollout immediate|gradual|none] [--images-only]",
      "",
      "Default output is a PATCH body for Takosumi's service-side InstallConfig.",
      "No OpenTofu variable or Output carries lifecycle control data.",
      "",
      "--images-only prints only the image map for release-helper diagnostics.",
    ].join("\n"),
  );
  process.exit(2);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const payload = options.imagesOnly
    ? releaseContainerImagesFromWorkerArtifact(manifest)
    : lifecycleConfigFromWorkerArtifact(manifest, options);
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.output) {
    writeFileSync(options.output, text);
    console.log(
      `Wrote ${options.imagesOnly ? "release container images" : "Takosumi InstallConfig lifecycle patch"} to ${options.output}.`,
    );
    return;
  }

  process.stdout.write(text);
}

export function parseArgs(argv) {
  let manifestPath = null;
  let output = null;
  let environment = "production";
  let executor = "operator";
  let rollout = "immediate";
  let imagesOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index] ?? null;
      if (!output) usage();
      continue;
    }
    if (value === "--environment") {
      environment = argv[++index] ?? "";
      if (!environment) usage();
      continue;
    }
    if (value === "--executor") {
      executor = argv[++index] ?? "";
      if (executor !== "runner" && executor !== "operator") usage();
      continue;
    }
    if (value === "--rollout") {
      rollout = argv[++index] ?? "";
      if (!["immediate", "gradual", "none"].includes(rollout)) usage();
      continue;
    }
    if (value === "--images-only") {
      imagesOnly = true;
      continue;
    }
    if (value.startsWith("--")) usage();
    if (manifestPath !== null) usage();
    manifestPath = value;
  }

  if (!manifestPath) usage();
  return {
    manifestPath,
    output,
    environment,
    executor,
    rollout,
    imagesOnly,
  };
}

export function releaseContainerImagesFromWorkerArtifact(manifest) {
  assertWorkerArtifactManifest(manifest);
  const images = manifest.containerImages;
  if (!images || typeof images !== "object" || Array.isArray(images)) {
    throw new Error("worker artifact containerImages must be an object");
  }
  const result = Object.fromEntries(
    Object.entries(images).filter(([, value]) => typeof value === "string"),
  );
  const normalized = normalizeReleaseContainerImages(result);
  if (Object.keys(normalized).length === 0) {
    throw new Error(
      "worker artifact containerImages must contain a supported Takos runtime or executor image",
    );
  }
  return result;
}

export function lifecycleConfigFromWorkerArtifact(
  manifest,
  {
    environment = "production",
    executor = "operator",
    rollout = "immediate",
  } = {},
) {
  if (executor !== "runner" && executor !== "operator") {
    throw new Error(`unsupported lifecycle executor: ${executor}`);
  }
  if (!["immediate", "gradual", "none"].includes(rollout)) {
    throw new Error(`unsupported container rollout: ${rollout}`);
  }
  if (typeof environment !== "string" || environment.trim() === "") {
    throw new Error("lifecycle environment must be a non-empty string");
  }

  assertWorkerArtifactManifest(manifest);
  const images = releaseContainerImagesFromWorkerArtifact(manifest);
  const commonEnv = {
    TAKOS_RELEASE_CONTAINER_IMAGES_JSON: JSON.stringify(images),
    TAKOS_RELEASE_WORKER_ARTIFACT_URL: manifest.artifact.url,
    TAKOS_RELEASE_WORKER_ARTIFACT_SHA256: manifest.artifact.sha256,
    TAKOS_WRANGLER_CONTAINERS_ROLLOUT: rollout,
    ...(executor === "operator"
      ? { TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES: "1" }
      : {}),
  };
  const providerCredentialOptIn =
    executor === "runner" ? { useProviderCredentials: true } : {};

  return {
    kind: "takosumi.install-config-lifecycle-patch@v1",
    lifecycleActions: [
      {
        apiVersion: "takosumi.dev/v1alpha1",
        kind: "command",
        id: "takos-worker-release",
        phase: "post_apply",
        executor,
        command: [
          "bun",
          "scripts/control/takosumi-release.mjs",
          environment.trim(),
        ],
        workingDirectory: ".",
        env: commonEnv,
        timeoutSeconds: 1200,
        runnerCapability: LIFECYCLE_CAPABILITY,
        ...providerCredentialOptIn,
      },
      {
        apiVersion: "takosumi.dev/v1alpha1",
        kind: "command",
        id: "takos-worker-destroy",
        phase: "pre_destroy",
        executor,
        command: [
          "bun",
          "scripts/control/takosumi-release.mjs",
          environment.trim(),
          "--destroy",
        ],
        workingDirectory: ".",
        env: { TAKOS_WRANGLER_CONTAINERS_ROLLOUT: rollout },
        timeoutSeconds: 600,
        runnerCapability: LIFECYCLE_CAPABILITY,
        ...providerCredentialOptIn,
      },
    ],
    lifecycleActionPolicy: {
      allowedExecutors: [executor],
      allowedRunnerCapabilities: [LIFECYCLE_CAPABILITY],
      ...(executor === "runner" ? { allowProviderCredentials: true } : {}),
    },
  };
}

export function assertWorkerArtifactManifest(manifest) {
  if (
    manifest?.kind !== "takosumi.worker-artifact@v1" ||
    manifest?.app !== "takos"
  ) {
    throw new Error(
      "manifest must be a takosumi.worker-artifact@v1 record for takos",
    );
  }
  if (
    typeof manifest?.artifact?.url !== "string" ||
    !/^https:\/\/[^\s]+$/u.test(manifest.artifact.url) ||
    typeof manifest?.artifact?.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.artifact.sha256)
  ) {
    throw new Error("worker artifact URL and SHA-256 are required");
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error ?? "unknown error"),
    );
    process.exit(1);
  }
}
