#!/usr/bin/env bun

// Self-host installation activation is intentionally not a raw repository
// deploy command. Takosumi invokes the SourceSnapshot-owned product materializer
// as a lifecycle action and retains Run/StateVersion/Output/Audit authority.

import {
  parseReleaseArtifactArgs,
  runReleaseArtifact,
  TAKOS_RELEASE_ARTIFACT_SURFACE,
} from "./release-artifact-deploy.ts";

const CONTRACT = {
  kind: "takos.deploy-contract@v2",
  surfaces: [
    TAKOS_RELEASE_ARTIFACT_SURFACE,
    {
      surface: "takos-product-materialization",
      target: "takosumi-runner:cloudflare-self-host-install",
      covers: [
        "deploy/cloudflare/wrangler.toml",
        "deploy/opentofu",
        "package.json",
        "scripts/build-worker-release-artifact.ts",
        "scripts/takos-product-materializer.ts",
      ],
      requiresScripts: [
        "check",
        "product:activate",
        "product:pre-destroy",
      ],
      requiresTools: ["bun"],
      requiresEnv: [],
      triggers: ["irreversible", "authority"],
      obligations: {
        provenance:
          "the Takosumi host injects the Plan-pinned SourceSnapshot id and full source commit; product:activate requires the descriptor commit and package version to match, verifies the descriptor and Worker archive SHA-256, accepts only digest-pinned container images in the selected Cloudflare account, and records only redacted digests in its terminal evidence",
        "post-conditions":
          "product:activate reads back the 100 percent Worker deployment and provenance annotations, exact secret-name closure, all four container images and capacities, all eight queue consumers, Vectorize shape, and the public health endpoint before succeeding; product:pre-destroy proves those app-owned follow-up resources absent before OpenTofu destroys backing resources",
        reversal:
          "the previous deployment and version ids are captured before mutation, but D1 migrations are forward-only; repair forward by default, or select the preceding exact descriptor only through a fresh reviewed Takosumi plan with explicit schema compatibility proof",
        "failure-handling":
          "every local and remote preflight fails closed; after the first writer, terminal JSON names completed stages and a diagnostic digest without provider output, credentials, resource ids, or secret values, and requires authoritative Cloudflare readback plus a fresh Takosumi plan rather than a blind retry",
        "pre-mutation-proof":
          "before the first writer, product:activate validates the complete output and provider closure, exact artifact bytes, archive paths, 0600 one-link secret file, local locked Wrangler version, generated Wrangler dry-run, existing deployment, secret names, containers, queue ownership, and Vectorize shape; conflicting owners or custom provider endpoints block",
        "independent-review":
          "the operator retains the independently reviewed Takosumi Plan and Plan-pinned InstallConfig lifecycle declaration; neither the source repository, this contract probe, nor a green portable check can authorize the runner action",
      },
    },
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

process.stderr.write(
  "deploy blocked: this entrypoint never runs a staging or production activation. Takosumi invokes " +
    "product:activate/product:pre-destroy from an exact SourceSnapshot.\n",
);
process.exit(1);
