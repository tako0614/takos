#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { normalizeReleaseContainerImages } from "./takosumi-release.mjs";

function usage() {
  console.error(
    "Usage: TAKOS_RELEASE_CONTAINER_IMAGES_JSON='<json>' bun scripts/control/apply-release-container-images.mjs <wrangler-config>",
  );
  process.exit(2);
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const [configPath] = argv;
  if (!configPath) usage();

  const images = normalizeReleaseContainerImages(
    env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
  );
  const imageEntries = Object.entries(images);
  if (imageEntries.length === 0) {
    console.log("No prebuilt release container images supplied.");
    return;
  }

  const input = readFileSync(configPath, "utf8");
  const output = applyReleaseContainerImagesToToml(input, images);
  writeFileSync(configPath, output);

  console.log(
    `Applied ${imageEntries.length} prebuilt release container image override(s) to ${configPath}.`,
  );
}

export function applyReleaseContainerImagesToToml(input, images) {
  const lines = input.split("\n");
  const output = [];
  let inContainerBlock = false;
  let currentClassName = null;
  let activeImage = null;
  let replaced = 0;

  for (const line of lines) {
    if (/^\s*\[\[.*containers\]\]\s*$/u.test(line)) {
      inContainerBlock = true;
      currentClassName = null;
      activeImage = null;
      output.push(line);
      continue;
    }

    if (/^\s*\[\[/u.test(line)) {
      inContainerBlock = false;
      currentClassName = null;
      activeImage = null;
      output.push(line);
      continue;
    }

    if (inContainerBlock) {
      const classMatch = line.match(/^\s*class_name\s*=\s*"([^"]+)"\s*$/u);
      if (classMatch) {
        currentClassName = classMatch[1];
        activeImage = images[currentClassName] ?? null;
        output.push(line);
        continue;
      }

      if (activeImage && /^\s*image\s*=/u.test(line)) {
        output.push(`image = ${JSON.stringify(activeImage)}`);
        replaced += 1;
        continue;
      }

      if (activeImage && /^\s*image_build_context\s*=/u.test(line)) {
        continue;
      }
    }

    output.push(line);
  }

  const missing = Object.keys(images).filter(
    (className) =>
      !new RegExp(`class_name\\s*=\\s*"${escapeRegExp(className)}"`).test(
        input,
      ),
  );
  if (missing.length > 0) {
    throw new Error(
      `Wrangler config is missing container class_name(s): ${missing.join(", ")}`,
    );
  }
  if (replaced === 0) {
    throw new Error(
      "No container image lines were replaced in Wrangler config",
    );
  }

  return output.join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.main) {
  main();
}
