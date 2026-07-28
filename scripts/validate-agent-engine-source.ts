#!/usr/bin/env -S bun

import path from "node:path";
import * as runtime from "./runtime.ts";
import {
  INTEGRATION_LOCK_PATH,
  type AgentEngineSource,
  validateIntegrationLockSource,
} from "./validate-agent-runtime-release.ts";

export function validateAgentEngineCheckoutState(
  source: AgentEngineSource,
  head: string,
  porcelainStatus: string,
): string[] {
  const errors: string[] = [];
  if (head.trim() !== source.commit) {
    errors.push(
      `takos-agent-engine checkout HEAD ${head.trim() || "<missing>"} does not match pinned commit ${source.commit}`,
    );
  }
  if (porcelainStatus.trim()) {
    errors.push(
      "takos-agent-engine checkout must be clean before validating a release source",
    );
  }
  return errors;
}

async function main(): Promise<void> {
  const takosRoot = path.resolve(import.meta.dir, "..");
  const integrationLockPath =
    runtime.env.get("TAKOS_INTEGRATION_LOCK_PATH") ?? INTEGRATION_LOCK_PATH;
  const parsed = JSON.parse(
    await runtime.readTextFile(integrationLockPath),
  ) as unknown;
  const takosHeadResult = await runtime.runCommand("git", {
    args: ["rev-parse", "HEAD"],
    cwd: takosRoot,
  });
  if (!takosHeadResult.success) {
    reportErrors(["failed to resolve Takos HEAD"]);
  }
  const sourceValidation = validateIntegrationLockSource(
    parsed,
    new TextDecoder().decode(takosHeadResult.stdout).trim(),
  );
  if (!sourceValidation.source) {
    reportErrors(sourceValidation.errors);
  }
  const source = sourceValidation.source;
  const checkout = path.resolve(
    runtime.env.get("TAKOS_AGENT_ENGINE_CHECKOUT") ??
      path.join(import.meta.dir, "../../takos-agent-engine"),
  );

  try {
    const info = await runtime.stat(checkout);
    if (!info.isDirectory) {
      reportErrors([
        `takos-agent-engine checkout is not a directory: ${checkout}`,
      ]);
    }
  } catch {
    reportErrors([
      `takos-agent-engine checkout is required at ${checkout}; set TAKOS_AGENT_ENGINE_CHECKOUT to override`,
    ]);
  }

  const [headResult, statusResult] = await Promise.all([
    runtime.runCommand("git", {
      args: ["rev-parse", "HEAD"],
      cwd: checkout,
    }),
    runtime.runCommand("git", {
      args: ["status", "--porcelain"],
      cwd: checkout,
    }),
  ]);
  if (!headResult.success || !statusResult.success) {
    reportErrors([
      `failed to inspect takos-agent-engine checkout at ${checkout}`,
    ]);
  }
  const decoder = new TextDecoder();
  const errors = validateAgentEngineCheckoutState(
    source,
    decoder.decode(headResult.stdout),
    decoder.decode(statusResult.stdout),
  );
  if (errors.length > 0) reportErrors(errors);

  const check = await runtime.runCommand("cargo", {
    args: [
      "check",
      "--locked",
      "--manifest-path",
      "containers/agent/Cargo.toml",
    ],
    cwd: takosRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!check.success) {
    reportErrors([
      `takos-agent wrapper does not compile against pinned engine ${source.commit}`,
    ]);
  }

  console.log(
    `Agent wrapper compiles against clean pinned engine ${source.commit}.`,
  );
}

function reportErrors(errors: string[]): never {
  console.error("Agent engine source validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  runtime.exit(1);
}

if (import.meta.main) await main();
