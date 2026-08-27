#!/usr/bin/env bun

// This entrypoint publishes the immutable Takos Worker release artifact only.
// Infrastructure deployment remains an operator-owned OpenTofu concern.

import {
  parseReleaseArtifactArgs,
  runReleaseArtifact,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
} from "./release-artifact-deploy.ts";

const CONTRACT = {
  kind: "takos.deploy-contract@v2",
  surfaces: [TAKOS_RELEASE_ARTIFACT_SURFACE],
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

process.stderr.write(
  "deploy blocked: use the takos-release-artifact surface with an explicit phase and evidence path.\n",
);
process.exit(1);
