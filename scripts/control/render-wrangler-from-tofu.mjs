#!/usr/bin/env bun
import * as runtime from "../runtime.ts";
// Render deploy/cloudflare/wrangler.toml resource-id placeholders from the
// OpenTofu module's outputs, closing the hand-copy gap in the self-host path.
//
// Usage:
//   bun scripts/control/render-wrangler-from-tofu.mjs <environment> [--zone-id <id>] [--dry-run]
//
// Environments: production (base config placeholders) | staging
// ([env.staging] placeholders). Run `tofu apply` in deploy/opentofu FIRST, then
// run this from the OpenTofu module dir so `tofu output -json` resolves, e.g.:
//
//   cd deploy/opentofu && tofu apply -var 'cloudflare={account_id="<acct>"}'
//   bun ../../scripts/control/render-wrangler-from-tofu.mjs production --zone-id <zone>
//
// What it fills (per environment): CF_ACCOUNT_ID + the three D1 database ids
// (DB / TAKOSUMI_ACCOUNTS_DB / TAKOSUMI_CONTROL_DB) + the two KV namespace ids
// (HOSTNAME_ROUTING / ROLLOUT_HEALTH_KV). CF_ZONE_ID is NOT a module-managed
// resource (it is the self-hoster's existing DNS zone), so pass it with
// --zone-id or fill the remaining `replace-with-*zone-id` placeholder by hand.
// The Vectorize index, container images, SPA build, secrets, and the
// accounts-D1 migration are NOT resource-id placeholders and are handled by the
// runbook (deploy/TAKOSUMI_DEPLOY.md), not by this script.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ENVIRONMENTS = ["production", "staging"];

// Wrangler config is resolved relative to THIS script (takos/scripts/control/),
// so the command works from any cwd (in particular from deploy/opentofu where
// `tofu output` must run).
const WRANGLER_CONFIG = resolve(
  import.meta.dirname,
  "../../deploy/cloudflare/wrangler.toml",
);

function usage() {
  console.error(`
Usage: bun scripts/control/render-wrangler-from-tofu.mjs <environment> [--zone-id <id>] [--dry-run]

Environments:
  production     Fill the base [vars]/bindings placeholders.
  staging        Fill the [env.staging] placeholders.

Flags:
  --zone-id <id> Fill CF_ZONE_ID (the module does not manage your DNS zone).
  --dry-run      Print the replacements without writing wrangler.toml.

Run \`tofu apply\` in deploy/opentofu first, then run this from that dir so
\`tofu output -json\` resolves.
`);
  runtime.exit(1);
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

/**
 * Map a parsed `tofu output -json` object to the wrangler placeholder strings
 * for one environment. Returns { [placeholder]: value }. Throws if a required
 * Cloudflare output is missing (e.g. the module was applied with a non-cloudflare
 * target).
 */
export function buildReplacements(outputs, env, { zoneId } = {}) {
  if (!ENVIRONMENTS.includes(env)) {
    throw new Error(`Unknown environment "${env}"`);
  }
  const read = (name) => {
    const entry = outputs[name];
    if (!entry || entry.value == null) {
      throw new Error(
        `tofu output "${name}" is missing or null. Did you \`tofu apply\` the cloudflare target first?`,
      );
    }
    return entry.value;
  };

  const accountId = read("cloudflare_account_id");
  const d1 = read("cloudflare_d1_database_ids"); // { db, accounts, deploy }
  const kv = read("cloudflare_kv_namespace_ids"); // { hostname_routing, rollout_health }
  const requireKey = (obj, key, outputName) => {
    if (obj[key] == null) {
      throw new Error(`tofu output "${outputName}" has no "${key}" key`);
    }
    return obj[key];
  };

  // placeholder string in wrangler.toml -> resolved value
  const prefix = env === "staging" ? "staging-" : "";
  const replacements = {
    [`replace-with-${prefix}account-id`]: accountId,
    [`replace-with-${prefix}d1-database-id`]: requireKey(d1, "db", "cloudflare_d1_database_ids"),
    [`replace-with-${prefix}accounts-d1-database-id`]: requireKey(d1, "accounts", "cloudflare_d1_database_ids"),
    [`replace-with-${prefix}deploy-d1-database-id`]: requireKey(d1, "deploy", "cloudflare_d1_database_ids"),
    [`replace-with-${prefix}hostname-routing-kv-namespace-id`]: requireKey(kv, "hostname_routing", "cloudflare_kv_namespace_ids"),
    [`replace-with-${prefix}rollout-health-kv-namespace-id`]: requireKey(kv, "rollout_health", "cloudflare_kv_namespace_ids"),
  };
  if (zoneId) {
    replacements[`replace-with-${prefix}zone-id`] = zoneId;
  }
  return replacements;
}

/** Apply { placeholder: value } literally to the wrangler.toml text. */
export function applyReplacements(toml, replacements) {
  let next = toml;
  const applied = [];
  const missing = [];
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!next.includes(placeholder)) {
      missing.push(placeholder);
      continue;
    }
    next = next.split(placeholder).join(value);
    applied.push({ placeholder, value });
  }
  return { toml: next, applied, missing };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  let zoneId;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--zone-id") {
      zoneId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      fail(`Error: unknown flag "${arg}".`);
    } else {
      positional.push(arg);
    }
  }
  const [env] = positional;
  if (!env) {
    fail("Error: environment is required.");
  }
  if (!ENVIRONMENTS.includes(env)) {
    fail(`Error: unknown environment "${env}". Valid: ${ENVIRONMENTS.join(", ")}`);
  }
  return { env, zoneId, dryRun };
}

function readTofuOutputs() {
  const json = execSync("tofu output -json", { encoding: "utf8" });
  return JSON.parse(json);
}

export function main(argv = process.argv.slice(2)) {
  const { env, zoneId, dryRun } = parseArgs(argv);
  const outputs = readTofuOutputs();
  const replacements = buildReplacements(outputs, env, { zoneId });
  const toml = readFileSync(WRANGLER_CONFIG, "utf8");
  const { toml: next, applied, missing } = applyReplacements(toml, replacements);

  for (const { placeholder, value } of applied) {
    console.log(`  ${placeholder} -> ${value}`);
  }
  if (missing.length > 0) {
    console.log(
      `\nAlready filled (placeholder not found, skipped): ${missing.join(", ")}`,
    );
  }
  if (!zoneId) {
    const zonePlaceholder = env === "staging"
      ? "replace-with-staging-zone-id"
      : "replace-with-zone-id";
    if (next.includes(zonePlaceholder)) {
      console.log(
        `\nNOTE: ${zonePlaceholder} is unset. The module does not manage your DNS zone; ` +
          `re-run with --zone-id <id> or fill CF_ZONE_ID by hand.`,
      );
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: wrangler.toml not written.");
    return;
  }
  writeFileSync(WRANGLER_CONFIG, next);
  console.log(`\nWrote ${applied.length} replacement(s) to ${WRANGLER_CONFIG}.`);
}

if (import.meta.main) {
  main();
}
