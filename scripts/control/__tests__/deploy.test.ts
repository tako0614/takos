import { assertEquals } from '@std/assert';

import { buildDeployCommands, getWranglerDeployArgs } from '../deploy.mjs';

Deno.test('getWranglerDeployArgs omits --env for production', () => {
  assertEquals(getWranglerDeployArgs('production'), []);
  assertEquals(getWranglerDeployArgs('staging'), ['--env', 'staging']);
});

Deno.test('buildDeployCommands uses the unified Wrangler config for production worker deploys', () => {
  assertEquals(buildDeployCommands('worker', 'production'), [
    'deno task build',
    'deno run -A npm:wrangler deploy --config deploy/cloudflare/wrangler.toml',
  ]);
});

Deno.test('buildDeployCommands targets the staging overlay for dispatch workers', () => {
  assertEquals(buildDeployCommands('dispatch', 'staging'), [
    'deno run -A npm:wrangler deploy --config deploy/cloudflare/wrangler.dispatch.toml --env staging',
  ]);
});

Deno.test('buildDeployCommands supports the worker staging debug build', () => {
  assertEquals(buildDeployCommands('worker', 'staging', { debug: true }), [
    'deno task build --mode staging-debug',
    'deno run -A npm:wrangler deploy --config deploy/cloudflare/wrangler.toml --env staging',
  ]);
});
