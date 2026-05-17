/**
 * ============================================================================
 * LOCAL-SUBSTRATE TEST RUNNER ONLY.
 *
 * This runner pass-throughs every TAKOSUMI_ACCOUNTS_* env var of the host
 * process into the miniflare worker bindings. That convenience is acceptable
 * inside the local-substrate docker network — where the host process IS the
 * test harness — but in production it would be a credential-exfiltration
 * vector: any env var with the right prefix would leak into worker context
 * regardless of whether the operator intended to expose it.
 *
 * Production deploys go through `wrangler deploy` with an explicit env block
 * in wrangler.toml or the Cloudflare dashboard. THIS FILE MUST NEVER BE
 * COPIED to a production runner. The LOCAL_SUBSTRATE_TEST_BED=1 guard below
 * fails fast if someone tries.
 * ============================================================================
 *
 * Boots the takosumi-cloud Accounts Worker (the bundle produced by
 * `deno bundle` from takosumi-cloud/deploy/cloudflare/src/worker.ts)
 * inside Miniflare with local D1 and R2 bindings. Mirrors the
 * cloud.takosumi.com production setup, just substituting Cloudflare D1/R2
 * with miniflare's emulated stores under /data.
 */
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

if (process.env.LOCAL_SUBSTRATE_TEST_BED !== '1') {
  console.error(
    '[takosumi-cloud-worker] refusing to start: this runner is local-substrate-only.\n' +
      '    It pass-throughs ALL TAKOSUMI_ACCOUNTS_* env vars into worker bindings,\n' +
      '    which is a credential leak path outside a controlled test bed.\n' +
      '    For production use `wrangler deploy` with an explicit env block.\n' +
      '    For local-substrate use, set LOCAL_SUBSTRATE_TEST_BED=1.',
  );
  process.exit(1);
}

const scriptPath = process.env.WORKER_SCRIPT ??
  '/worker/takosumi-cloud-accounts-worker.mjs';
const port = Number(process.env.WORKER_PORT ?? 8787);
const scriptContents = readFileSync(scriptPath, 'utf8');

// Pass through every TAKOSUMI_ACCOUNTS_* env var as a worker binding so we
// don't have to enumerate each new config knob (managed-offering refs,
// install_preview URL, upstream OAuth, passkey RP, etc) in this runner.
const bindings = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && k.startsWith('TAKOSUMI_ACCOUNTS_')),
);
// Sensible defaults if the operator forgot to set the basics.
bindings.TAKOSUMI_ACCOUNTS_ISSUER ??= 'https://cloud.takosumi.test';
bindings.TAKOSUMI_ACCOUNTS_SUBJECT ??= 'tsub_takosumi_cloud_local';
bindings.TAKOSUMI_ACCOUNTS_CLIENT_ID ??= 'takos-app-local';
bindings.TAKOSUMI_ACCOUNTS_REDIRECT_URIS ??= 'https://app.takos.test/oauth/callback';
bindings.TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_ACCESS ??= 'closed';
bindings.TAKOSUMI_ACCOUNTS_EXPORT_DOWNLOAD_SECRET ??= 'local-substrate-export-download-secret-v1';

const mf = new Miniflare({
  modules: [{
    type: 'ESModule',
    path: basename(scriptPath),
    contents: scriptContents,
  }],
  host: '0.0.0.0',
  port,
  compatibilityDate: process.env.WORKER_COMPATIBILITY_DATE ?? '2026-04-15',
  d1Databases: { TAKOSUMI_ACCOUNTS_DB: 'takosumi-cloud-accounts' },
  d1Persist: '/data/d1',
  r2Buckets: ['TAKOSUMI_ACCOUNTS_EXPORTS'],
  r2Persist: '/data/r2',
  bindings,
});

const url = await mf.ready;
console.log(`[takosumi-cloud-worker] miniflare serving at ${url}`);
