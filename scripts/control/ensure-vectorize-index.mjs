#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";

function usage() {
  console.error(`
Usage: bun scripts/control/ensure-vectorize-index.mjs <name> --dimensions <n> --metric <metric> [--account-id <id>]

Creates a Cloudflare Vectorize index and treats duplicate_name as success so
Takosumi post-apply release activation can be retried safely.
`);
  process.exit(1);
}

const [name, ...args] = process.argv.slice(2);
if (!name) usage();

function readOption(parts, option) {
  const index = parts.indexOf(option);
  if (index === -1) return { value: undefined, rest: parts };
  const value = parts[index + 1];
  if (!value || value.startsWith("--")) usage();
  return {
    value,
    rest: [...parts.slice(0, index), ...parts.slice(index + 2)],
  };
}

const accountIdOption = readOption(args, "--account-id");
const wranglerArgs = accountIdOption.rest;
const nativeProcessEnv = { ...process.env };
delete nativeProcessEnv.TAKOS_CLOUDFLARE_API_BASE_URL;
delete nativeProcessEnv.CLOUDFLARE_API_BASE_URL;
delete nativeProcessEnv.CF_API_BASE_URL;
delete nativeProcessEnv.CLOUDFLARE_BASE_URL;
const env = {
  ...nativeProcessEnv,
  ...(accountIdOption.value
    ? { CLOUDFLARE_ACCOUNT_ID: accountIdOption.value }
    : {}),
};

const result = spawnSync(
  "bunx",
  ["wrangler", "vectorize", "create", name, ...wranglerArgs],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (
  result.status === 0 ||
  combined.includes("vectorize.index.duplicate_name")
) {
  if (combined.includes("vectorize.index.duplicate_name")) {
    console.log(`Vectorize index ${name} already exists; continuing.`);
  }
  const verify = spawnSync(
    "bunx",
    ["wrangler", "vectorize", "get", name, "--json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
  if (verify.stdout) process.stdout.write(verify.stdout);
  if (verify.stderr) process.stderr.write(verify.stderr);
  process.exit(verify.status ?? 1);
}

process.exit(result.status ?? 1);
