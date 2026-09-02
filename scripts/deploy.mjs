#!/usr/bin/env bun

// The one Takos deploy entrypoint. It publishes two things and nothing else:
//
//   takos-release-artifact       the immutable Worker release archive and the
//                                digest-pinned agent images consumers pin
//   takos-cloudflare-production  one Cloudflare account's served Takos Worker,
//                                composed from the OpenTofu module's durable
//                                infrastructure and this repository's worker
//                                artifact half
//
// Obligations and triggers live in takos-control `engineering.policy.json`.
// `--contract` is side-effect free and describes both surfaces.

import {
  parseReleaseArtifactArgs,
  runReleaseArtifact,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
} from "./release-artifact-deploy.ts";
import {
  CLOUDFLARE_PRODUCTION_USAGE,
  parseCloudflareProductionArgs,
  runCloudflareProduction,
  TAKOS_CLOUDFLARE_PRODUCTION_SURFACE,
} from "./cloudflare-production-deploy.ts";

const CONTRACT = {
  kind: "takos.deploy-contract@v2",
  surfaces: [
    TAKOS_RELEASE_ARTIFACT_SURFACE,
    TAKOS_CLOUDFLARE_PRODUCTION_SURFACE,
  ],
};

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--contract") {
  process.stdout.write(`${JSON.stringify(CONTRACT, null, 2)}\n`);
  process.exit(0);
}

if (args[0] === TAKOS_RELEASE_ARTIFACT_SURFACE.surface) {
  try {
    const result = await runReleaseArtifact(
      parseReleaseArtifactArgs(args.slice(1)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (args[0] === TAKOS_CLOUDFLARE_PRODUCTION_SURFACE.surface) {
  try {
    const result = await runCloudflareProduction(
      parseCloudflareProductionArgs(args.slice(1), process.cwd()),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    // Raw diagnostics, and the exit code says which side of the mutation the
    // failure fell on: 2 nothing touched, 3 indeterminate, 4 published but a
    // post-condition failed.
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (error && typeof error === "object" && "detail" in error && error.detail) {
      process.stderr.write(`${error.detail}\n`);
    }
    const exitCode =
      error && typeof error === "object" && typeof error.exitCode === "number"
        ? error.exitCode
        : 1;
    // Exit 2 means nothing was touched, so the operator is being told how to
    // invoke this. Exit 3 and 4 already happened against the account; usage
    // text there would bury the diagnostic that matters.
    if (exitCode < 3) process.stderr.write(`${CLOUDFLARE_PRODUCTION_USAGE}\n`);
    process.exit(exitCode);
  }
}

process.stderr.write(
  "deploy blocked: name a surface with an explicit phase. " +
    `Surfaces: ${CONTRACT.surfaces.map((surface) => surface.surface).join(", ")}. ` +
    "Run `bun run deploy -- --contract` for what each one publishes and owes.\n",
);
process.exit(1);
