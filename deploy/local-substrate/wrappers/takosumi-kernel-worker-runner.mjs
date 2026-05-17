/**
 * ============================================================================
 * LOCAL-SUBSTRATE TEST RUNNER ONLY.
 *
 * Boots takosumi/deploy/cloudflare's Worker-first kernel scaffold in
 * Miniflare with local D1 and R2 bindings. Production deploys must use
 * `wrangler deploy --config takosumi/deploy/cloudflare/wrangler.toml` with
 * explicit operator-managed bindings and secrets.
 * ============================================================================
 */
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

if (process.env.LOCAL_SUBSTRATE_TEST_BED !== '1') {
  console.error(
    '[takosumi-kernel-worker] refusing to start: this runner is local-substrate-only.\n' +
      '    It injects local fixture bindings/secrets for Miniflare D1/R2.\n' +
      '    For production use wrangler deploy with explicit Cloudflare bindings.\n' +
      '    For local-substrate use, set LOCAL_SUBSTRATE_TEST_BED=1.',
  );
  process.exit(1);
}

const scriptPath = process.env.WORKER_SCRIPT ??
  '/worker/takosumi-cloudflare-worker.mjs';
const port = Number(process.env.WORKER_PORT ?? 8788);
const scriptContents = readFileSync(scriptPath, 'utf8');

const bindings = Object.fromEntries(
  Object.entries(process.env).filter(([key, value]) =>
    typeof value === 'string' &&
    (key.startsWith('TAKOSUMI_') || key.startsWith('TAKOS_'))
  ),
);

bindings.TAKOS_RUNTIME_MODE ??= 'cloudflare-worker';
bindings.TAKOSUMI_ENVIRONMENT ??= 'development';
bindings.TAKOSUMI_PUBLIC_ROUTES_ENABLED ??= 'true';
bindings.TAKOSUMI_DEPLOY_TOKEN ??= 'local-substrate-deploy-token';
bindings.TAKOSUMI_DEPLOY_SPACE_ID ??= 'local-substrate-space';
bindings.TAKOSUMI_INTERNAL_API_SECRET ??= 'local-dev-secret';
bindings.TAKOSUMI_SECRET_STORE_PASSPHRASE ??= 'local-substrate-secret-store-passphrase-v1';

const mf = new Miniflare({
  modules: [{
    type: 'ESModule',
    path: basename(scriptPath),
    contents: scriptContents,
  }],
  host: '0.0.0.0',
  port,
  compatibilityDate: process.env.WORKER_COMPATIBILITY_DATE ?? '2026-04-15',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: { TAKOS_D1: 'takosumi-kernel' },
  d1Persist: '/data/d1',
  r2Buckets: ['TAKOS_ARTIFACTS'],
  r2Persist: '/data/r2',
  durableObjects: {
    TAKOS_COORDINATION: {
      className: 'TakosCoordinationObject',
      useSQLite: true,
    },
  },
  durableObjectsPersist: '/data/do',
  queueProducers: {
    TAKOS_QUEUE: { queueName: 'takosumi-control-plane' },
  },
  bindings,
});

const url = await mf.ready;
console.log(`[takosumi-kernel-worker] miniflare serving at ${url}`);
