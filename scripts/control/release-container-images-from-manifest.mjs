#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { normalizeReleaseContainerImages } from "./takosumi-release.mjs";

const RELEASE_IMAGE_ALIASES = {
  "takos-worker-runtime": "runtime",
  "takos-agent": "executor",
};

function usage() {
  console.error(
    [
      "Usage: bun scripts/control/release-container-images-from-manifest.mjs <release-manifest.json> [--output <path>] [--images-only]",
      "",
      "Default output is OpenTofu tfvars JSON:",
      '{ "release_container_images": { "runtime": "...", "executor": "..." } }',
      "",
      "--images-only prints only the image map for TAKOS_RELEASE_CONTAINER_IMAGES_JSON.",
    ].join("\n"),
  );
  process.exit(2);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const images = releaseContainerImagesFromManifest(manifest);
  const payload = options.imagesOnly
    ? images
    : { release_container_images: images };
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.output) {
    writeFileSync(options.output, text);
    console.log(
      `Wrote ${options.imagesOnly ? "release container images" : "OpenTofu release_container_images tfvars"} to ${options.output}.`,
    );
    return;
  }

  process.stdout.write(text);
}

export function parseArgs(argv) {
  let manifestPath = null;
  let output = null;
  let imagesOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index] ?? null;
      if (!output) usage();
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
  return { manifestPath, output, imagesOnly };
}

export function releaseContainerImagesFromManifest(manifest) {
  const images = manifest?.officialImages?.images;
  if (!Array.isArray(images)) {
    throw new Error("release manifest officialImages.images must be an array");
  }

  const result = {};
  const errors = [];

  for (const [imageName, alias] of Object.entries(RELEASE_IMAGE_ALIASES)) {
    const image = images.find((entry) => entry?.name === imageName);
    const ref =
      typeof image?.cloudflareRegistryRef === "string"
        ? image.cloudflareRegistryRef.trim()
        : "";

    if (!image) {
      errors.push(`${imageName}: missing official image entry`);
      continue;
    }
    if (!ref) {
      errors.push(
        `${imageName}: missing cloudflareRegistryRef; rerun Git CI with publish_cloudflare_registry=true after setting CLOUDFLARE_CONTAINERS_API_TOKEN`,
      );
      continue;
    }
    result[alias] = ref;
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  normalizeReleaseContainerImages(result);
  return result;
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
