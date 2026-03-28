#!/usr/bin/env node
// Parameterized deploy script for @takoserver/control-app services.
// Usage: node scripts/deploy.mjs <service> <environment> [--debug]
//
// Services: web, dispatch, worker, runtime-host, executor-host, browser-host
// Environments: production, staging
// Flags: --debug  (only valid for web + staging — uses staging-debug build)

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVICES = {
  web: null, // uses default wrangler.toml (no --config flag)
  dispatch: "wrangler.dispatch.toml",
  worker: "wrangler.worker.toml",
  "runtime-host": "wrangler.runtime-host.toml",
  "executor-host": "wrangler.executor.toml",
  "browser-host": "wrangler.browser-host.toml",
};

const ENVIRONMENTS = ["production", "staging"];

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const positional = args.filter((a) => !a.startsWith("--"));

const [service, env] = positional;

function usage() {
  console.error(`
Usage: node scripts/deploy.mjs <service> <environment> [--debug]

Services:
  web            Main web worker (runs deploy:prepare + build before deploy)
  dispatch       Dispatch service
  worker         Background worker
  runtime-host   Runtime host service
  executor-host  Executor host service
  browser-host   Browser host service

Environments:
  production     Deploy to production
  staging        Deploy to staging

Flags:
  --debug        Build with staging-debug mode (web + staging only)

Examples:
  node scripts/deploy.mjs web production
  node scripts/deploy.mjs web staging --debug
  node scripts/deploy.mjs dispatch staging
  node scripts/deploy.mjs runtime-host production
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

if (!service || !env) {
  console.error("Error: service and environment are required.\n");
  usage();
}

if (!(service in SERVICES)) {
  console.error(
    `Error: unknown service "${service}". Valid services: ${Object.keys(SERVICES).join(", ")}\n`,
  );
  usage();
}

if (!ENVIRONMENTS.includes(env)) {
  console.error(
    `Error: unknown environment "${env}". Valid environments: ${ENVIRONMENTS.join(", ")}\n`,
  );
  usage();
}

if (debug && (service !== "web" || env !== "staging")) {
  console.error("Error: --debug is only supported for web + staging.\n");
  usage();
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/** Run a shell command, inheriting stdio so output streams through. */
function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit" });
}

if (service === "web") {
  // Web requires building dependencies and the frontend before deploying.
  run("pnpm deploy:prepare");
  run(debug ? "pnpm build:debug" : "pnpm build");
  run(`wrangler deploy --env ${env}`);
} else {
  const config = SERVICES[service];
  run(`wrangler deploy --config ${config} --env ${env}`);
}

console.log(`\nDeployed ${service} to ${env} successfully.`);
