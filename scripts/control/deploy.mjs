#!/usr/bin/env bun
import * as runtime from "../runtime.ts";
// Parameterized deploy script for Takos Cloudflare services.
// Usage: bun scripts/control/deploy.mjs <service> <environment> [--debug]
//
// Service: worker (unified Takos Worker)
// Environments: production (base config), staging ([env.staging])
// Flags: --debug  (only valid for worker + staging — uses staging-debug build)

import { execSync } from 'node:child_process';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVICES = {
  worker: 'deploy/cloudflare/wrangler.toml',
};

const ENVIRONMENTS = ['production', 'staging'];

function usage() {
  console.error(`
Usage: bun run deploy:service <service> <environment> [--debug]

Service:
  worker         Unified public/control worker (runs build before deploy)

Environments:
  production     Deploy using the base Wrangler config (no --env flag)
  staging        Deploy using the [env.staging] overlay (--env staging)

Flags:
  --debug        Build with staging-debug mode (worker + staging only)

Examples:
  bun run deploy:service worker production
  bun run deploy:service worker staging --debug
`);
  runtime.exit(1);
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

export function getWranglerDeployArgs(env) {
  return env === 'staging' ? ['--env', 'staging'] : [];
}

export function buildDeployCommands(
  service,
  env,
  { debug = false } = {},
) {
  if (!(service in SERVICES)) {
    throw new Error(`Unknown service "${service}"`);
  }

  const wranglerArgs = getWranglerDeployArgs(env);
  const migrateBase = ['bunx', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote'];
  const deployBase = ['bunx', 'wrangler', 'deploy'];
  const commands = [];

  commands.push(
    debug ? 'bun run build --mode staging-debug' : 'bun run build',
  );
  // Apply control-DB D1 migrations (binding DB) before uploading the worker so
  // the deployed script never serves against an empty/stale schema.
  commands.push([...migrateBase, '--config', SERVICES.worker, ...wranglerArgs].join(' '));
  commands.push([...deployBase, '--config', SERVICES.worker, ...wranglerArgs].join(' '));
  return commands;
}

export function parseDeployArgs(argv = process.argv.slice(2)) {
  const debug = argv.includes('--debug');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const [service, env] = positional;

  if (!service || !env) {
    fail('Error: service and environment are required.');
  }

  if (!(service in SERVICES)) {
    fail(
      `Error: unknown service "${service}". Valid services: ${Object.keys(SERVICES).join(', ')}`,
    );
  }

  if (!ENVIRONMENTS.includes(env)) {
    fail(
      `Error: unknown environment "${env}". Valid environments: ${ENVIRONMENTS.join(', ')}`,
    );
  }

  if (debug && (service !== 'worker' || env !== 'staging')) {
    fail('Error: --debug is only supported for worker + staging.');
  }

  return { service, env, debug };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/** Run a shell command, inheriting stdio so output streams through. */
function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit' });
}

export function main(argv = process.argv.slice(2)) {
  const { service, env, debug } = parseDeployArgs(argv);
  const commands = buildDeployCommands(service, env, { debug });

  for (const command of commands) {
    run(command);
  }

  console.log(`\nDeployed ${service} to ${env} successfully.`);
}

if (import.meta.main) {
  main();
}
