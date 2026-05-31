#!/usr/bin/env -S deno run --allow-all
// Parameterized deploy script for Takos Cloudflare services.
// Usage: deno run --allow-all scripts/deploy.mjs <service> <environment> [--debug]
//
// Services: worker, dispatch, runtime-host, executor-host
// Environments: production (base config), staging ([env.staging])
// Flags: --debug  (only valid for worker + staging — uses staging-debug build)

import { execSync } from 'node:child_process';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVICES = {
  worker: 'deploy/cloudflare/wrangler.toml',
  dispatch: 'deploy/cloudflare/wrangler.dispatch.toml',
  'runtime-host': 'deploy/cloudflare/wrangler.runtime-host.toml',
  'executor-host': 'deploy/cloudflare/wrangler.executor.toml',
};

const ENVIRONMENTS = ['production', 'staging'];

function usage() {
  console.error(`
Usage: deno task deploy:service <service> <environment> [--debug]

Services:
  worker         Unified public/control worker (runs build before deploy)
  dispatch       Dispatch service
  runtime-host   Runtime host service
  executor-host  Executor host service

Environments:
  production     Deploy using the base Wrangler config (no --env flag)
  staging        Deploy using the [env.staging] overlay (--env staging)

Flags:
  --debug        Build with staging-debug mode (worker + staging only)

Examples:
  deno task deploy:service worker production
  deno task deploy:service worker staging --debug
  deno task deploy:service dispatch staging
  deno task deploy:service runtime-host production
`);
  Deno.exit(1);
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
  const deployBase = ['deno', 'run', '-A', 'npm:wrangler', 'deploy'];
  const commands = [];

  if (service === 'worker') {
    commands.push(
      debug ? 'deno task build --mode staging-debug' : 'deno task build',
    );
    commands.push([...deployBase, '--config', SERVICES.worker, ...wranglerArgs].join(' '));
    return commands;
  }

  const config = SERVICES[service];
  commands.push(
    [...deployBase, '--config', config, ...wranglerArgs].join(' '),
  );
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
