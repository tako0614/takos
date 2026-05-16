/**
 * Boots the takosumi-cloud Accounts Worker (the bundle produced by
 * `deno bundle` from takosumi-cloud/deploy/cloudflare/src/worker.ts)
 * inside Miniflare with a local SQLite D1 binding. Mirrors the
 * cloud.takosumi.com production setup, just substituting Cloudflare D1
 * with miniflare's emulated D1 stored at /data/d1.
 */
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const scriptPath = process.env.WORKER_SCRIPT ??
  "/worker/takosumi-cloud-accounts-worker.mjs";
const port = Number(process.env.WORKER_PORT ?? 8787);
const scriptContents = readFileSync(scriptPath, "utf8");

// Pass through every TAKOSUMI_ACCOUNTS_* env var as a worker binding so we
// don't have to enumerate each new config knob (managed-offering refs,
// install_preview URL, upstream OAuth, passkey RP, etc) in this runner.
const bindings = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) =>
    typeof v === "string" && k.startsWith("TAKOSUMI_ACCOUNTS_")
  ),
);
// Sensible defaults if the operator forgot to set the basics.
bindings.TAKOSUMI_ACCOUNTS_ISSUER ??= "https://cloud.takosumi.test";
bindings.TAKOSUMI_ACCOUNTS_SUBJECT ??= "tsub_takosumi_cloud_local";
bindings.TAKOSUMI_ACCOUNTS_CLIENT_ID ??= "takos-app-local";
bindings.TAKOSUMI_ACCOUNTS_REDIRECT_URIS ??=
  "https://app.takos.test/oauth/callback";
bindings.TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_ACCESS ??= "closed";

const mf = new Miniflare({
  modules: [{
    type: "ESModule",
    path: basename(scriptPath),
    contents: scriptContents,
  }],
  host: "0.0.0.0",
  port,
  compatibilityDate: process.env.WORKER_COMPATIBILITY_DATE ?? "2026-04-15",
  d1Databases: { TAKOSUMI_ACCOUNTS_DB: "takosumi-cloud-accounts" },
  d1Persist: "/data/d1",
  bindings,
});

const url = await mf.ready;
console.log(`[takosumi-cloud-worker] miniflare serving at ${url}`);
