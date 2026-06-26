#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import process from "node:process";

function usage() {
  console.error(`
Usage: bun scripts/control/ensure-vectorize-index.mjs <name> --dimensions <n> --metric <metric>

Creates a Cloudflare Vectorize index and treats duplicate_name as success so
Takosumi post-apply release activation can be retried safely.
`);
  process.exit(1);
}

const [name, ...args] = process.argv.slice(2);
if (!name) usage();

const result = spawnSync(
  "bunx",
  ["wrangler", "vectorize", "create", name, ...args],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0) process.exit(0);
if (combined.includes("vectorize.index.duplicate_name")) {
  console.log(`Vectorize index ${name} already exists; continuing.`);
  process.exit(0);
}

process.exit(result.status ?? 1);
