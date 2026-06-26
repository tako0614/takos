#!/usr/bin/env bun
import * as runtime from "../runtime.ts";

import { execSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parseTakosumiOutputsJson } from "./render-wrangler-from-tofu.mjs";

const ENVIRONMENTS = ["production", "staging"];
const WRANGLER_CONFIG = "deploy/cloudflare/wrangler.toml";

function usage() {
  console.error(`
Usage: bun scripts/control/takosumi-release.mjs <environment> [--debug]

Runs the operator-side artifact activation after Takosumi/OpenTofu has
provisioned durable resources. The command reads non-secret OpenTofu outputs
from TAKOSUMI_OUTPUTS_JSON, renders wrangler bindings, runs Takos-owned
release setup steps, and uploads the Worker artifact.

Environment:
  production
  staging

Optional env:
  TAKOS_CLOUDFLARE_ZONE_ID or CF_ZONE_ID  Render CF_ZONE_ID placeholders.
  TAKOS_RELEASE_TAKOSUMI_REPO_DIR         Takosumi source checkout to symlink
                                          beside a restored Takos source
                                          archive before build/migration.
  TAKOSUMI_REPO_DIR                       Sibling Takosumi checkout for the
                                          embedded accounts-plane migration
                                          command used by this distribution
                                          (legacy fallback).
`);
  runtime.exit(1);
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function commandLine(parts) {
  return parts.map(shellArg).join(" ");
}

function outputValue(entry) {
  if (entry == null) return undefined;
  if (
    typeof entry === "object" &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive")
  ) {
    return entry.value;
  }
  return entry;
}

function requireStringOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must include string output "${name}"`,
    );
  }
  return value;
}

function ensureTakosumiSourceModule(takosumiRepoDir) {
  const expected = resolve("..", "takosumi");
  if (existsSync(expected)) return;
  const source = resolve(takosumiRepoDir);
  if (!existsSync(source)) {
    throw new Error(
      `Takosumi source checkout was not found at ${source}; set TAKOS_RELEASE_TAKOSUMI_REPO_DIR in the operator release environment`,
    );
  }
  symlinkSync(source, expected, "dir");
}

export function parseReleaseArgs(argv = process.argv.slice(2)) {
  const debug = argv.includes("--debug");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const [environment] = positional;
  if (!environment) fail("Error: environment is required.");
  if (!ENVIRONMENTS.includes(environment)) {
    fail(
      `Error: unknown environment "${environment}". Valid: ${ENVIRONMENTS.join(", ")}`,
    );
  }
  if (debug && environment !== "staging") {
    fail("Error: --debug is only supported for staging.");
  }
  return { environment, debug };
}

export function readReleaseOutputs(env = process.env) {
  const raw = env.TAKOSUMI_OUTPUTS_JSON;
  if (!raw?.trim()) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON is required for Takos release");
  }
  return parseTakosumiOutputsJson(raw);
}

export function buildTakosumiReleaseCommands(
  outputs,
  environment,
  { debug = false, zoneId, takosumiRepoDir = "../takosumi" } = {},
) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}"`);
  }
  const accountId = requireStringOutput(outputs, "cloudflare_account_id");
  const accountsDatabaseId = requireStringOutput(
    outputs,
    "cloudflare_accounts_d1_database_id",
  );
  const wranglerEnvArgs = environment === "staging" ? ["--env", "staging"] : [];
  const renderArgs = [
    "bun",
    "scripts/control/render-wrangler-from-tofu.mjs",
    environment,
    ...(zoneId ? ["--zone-id", zoneId] : []),
  ];
  const installArgs = ["bun", "install", "--frozen-lockfile"];
  const buildArgs =
    debug && environment === "staging"
      ? ["bun", "run", "build", "--mode", "staging-debug"]
      : ["bun", "run", "build"];

  return [
    commandLine(renderArgs),
    commandLine(installArgs),
    commandLine(buildArgs),
    commandLine([
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      WRANGLER_CONFIG,
      ...wranglerEnvArgs,
    ]),
    commandLine([
      "bun",
      "--cwd",
      takosumiRepoDir,
      "run",
      "cli",
      "--",
      "accounts",
      "migrate-d1",
      "--database-id",
      accountsDatabaseId,
      "--account-id",
      accountId,
      "--remote",
    ]),
    commandLine([
      "bunx",
      "wrangler",
      "deploy",
      "--config",
      WRANGLER_CONFIG,
      ...wranglerEnvArgs,
    ]),
  ];
}

function run(command) {
  console.log(`\n> ${command}\n`);
  execSync(command, { stdio: "inherit" });
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { environment, debug } = parseReleaseArgs(argv);
  const outputs = readReleaseOutputs(env);
  const takosumiRepoDir =
    env.TAKOS_RELEASE_TAKOSUMI_REPO_DIR ??
    env.TAKOSUMI_REPO_DIR ??
    "../takosumi";
  ensureTakosumiSourceModule(takosumiRepoDir);
  const commands = buildTakosumiReleaseCommands(outputs, environment, {
    debug,
    zoneId: env.TAKOS_CLOUDFLARE_ZONE_ID ?? env.CF_ZONE_ID,
    takosumiRepoDir,
  });
  for (const command of commands) run(command);
  console.log(`\nTakos release activation completed for ${environment}.`);
}

if (import.meta.main) {
  main();
}
