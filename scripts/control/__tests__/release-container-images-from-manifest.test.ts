import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  main,
  parseArgs,
  releaseContainerImagesFromManifest,
} from "../release-container-images-from-manifest.mjs";

const runtimeRef =
  "registry.cloudflare.com/acc_123/takos-runtime@sha256:1111111111111111111111111111111111111111111111111111111111111111";
const executorRef =
  "registry.cloudflare.com/acc_123/takos-executor:0.10.0-abcdef123456";

function releaseManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    officialImages: {
      images: [
        {
          name: "takos-worker",
          cloudflareRegistryRef: null,
        },
        {
          name: "takos-runtime",
          cloudflareRegistryRef: runtimeRef,
        },
        {
          name: "takos-executor",
          cloudflareRegistryRef: executorRef,
        },
      ],
    },
    ...overrides,
  };
}

test("releaseContainerImagesFromManifest extracts OpenTofu aliases from Git CI release manifest", () => {
  assert.deepEqual(releaseContainerImagesFromManifest(releaseManifest()), {
    runtime: runtimeRef,
    executor: executorRef,
  });
});

test("releaseContainerImagesFromManifest fails closed without Cloudflare registry refs", () => {
  assert.throws(
    () =>
      releaseContainerImagesFromManifest(
        releaseManifest({
          officialImages: {
            images: [
              { name: "takos-runtime", cloudflareRegistryRef: null },
              { name: "takos-executor", cloudflareRegistryRef: executorRef },
            ],
          },
        }),
      ),
    /takos-runtime: missing cloudflareRegistryRef/,
  );
});

test("releaseContainerImagesFromManifest rejects non-Cloudflare deploy refs", () => {
  assert.throws(
    () =>
      releaseContainerImagesFromManifest(
        releaseManifest({
          officialImages: {
            images: [
              {
                name: "takos-runtime",
                cloudflareRegistryRef:
                  "ghcr.io/tako0614/takos-runtime@sha256:1111111111111111111111111111111111111111111111111111111111111111",
              },
              { name: "takos-executor", cloudflareRegistryRef: executorRef },
            ],
          },
        }),
      ),
    /Cloudflare Containers-supported registry ref/,
  );
});

test("parseArgs reads manifest path and output options", () => {
  assert.deepEqual(
    parseArgs([
      "release-manifest.json",
      "--output",
      "release.auto.tfvars.json",
    ]),
    {
      manifestPath: "release-manifest.json",
      output: "release.auto.tfvars.json",
      imagesOnly: false,
    },
  );
  assert.deepEqual(parseArgs(["release-manifest.json", "--images-only"]), {
    manifestPath: "release-manifest.json",
    output: null,
    imagesOnly: true,
  });
});

test("main writes OpenTofu tfvars JSON by default", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "takos-release-images-"));
  try {
    const manifestPath = resolve(dir, "release-manifest.json");
    const outputPath = resolve(dir, "release.auto.tfvars.json");
    writeFileSync(manifestPath, JSON.stringify(releaseManifest()));

    main([manifestPath, "--output", outputPath]);

    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {
      release_container_images: {
        runtime: runtimeRef,
        executor: executorRef,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
