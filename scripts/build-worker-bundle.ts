#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outputDirectory = await mkdtemp(
  join(tmpdir(), "takos-worker-bundle-check-"),
);

try {
  const result = spawnSync(
    "bunx",
    [
      "wrangler",
      "deploy",
      "--config",
      "deploy/cloudflare/wrangler.toml",
      "--env=",
      "--dry-run",
      "--containers-rollout",
      "none",
      "--outdir",
      outputDirectory,
    ],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Wrangler Worker bundle check failed with exit code ${
        result.status ?? "unknown"
      }`,
    );
  }
} finally {
  await rm(outputDirectory, { force: true, recursive: true });
}
