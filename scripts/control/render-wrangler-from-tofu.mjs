#!/usr/bin/env bun
import * as runtime from "../runtime.ts";
// Render deploy/cloudflare/wrangler.toml resource-id placeholders from the
// OpenTofu module's outputs, closing the hand-copy gap in the self-host path.
// Takosumi release commands pass the same non-sensitive outputs through
// TAKOSUMI_OUTPUTS_JSON, so this script can run without reading local tofu state.
//
// Usage:
//   bun scripts/control/render-wrangler-from-tofu.mjs <environment> [--zone-id <id>] [--out <path>] [--dry-run]
//
// Environments: production (base config placeholders) | staging
// ([env.staging] placeholders). Run `tofu apply` in deploy/opentofu FIRST, then
// run this from the OpenTofu module dir so `tofu output -json` resolves, e.g.:
//
//   cd deploy/opentofu && tofu apply -var 'cloudflare={account_id="<acct>"}'
//   bun ../../scripts/control/render-wrangler-from-tofu.mjs production --zone-id <zone>
//
// What it fills (per environment): Worker script name, CF_ACCOUNT_ID, the D1
// database id, KV namespace ids, R2 bucket names, Queue names, and Vectorize
// index name. CF_ZONE_ID is NOT a module-managed resource (it is the
// self-hoster's existing DNS zone), so pass it with --zone-id or fill the
// remaining `replace-with-*zone-id` placeholder by hand. Container images, SPA
// build, secrets, and D1 migrations are handled by the release command.

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
Usage: bun scripts/control/render-wrangler-from-tofu.mjs <environment> [--zone-id <id>] [--out <path>] [--dry-run]

Environments:
  production     Fill the base [vars]/bindings placeholders.
  staging        Fill the [env.staging] placeholders.

Flags:
  --zone-id <id> Fill CF_ZONE_ID (the module does not manage your DNS zone).
  --out <path>   Write the rendered config to this path instead of mutating
                 deploy/cloudflare/wrangler.toml.
  --dry-run      Print the replacements without writing wrangler.toml.

Run \`tofu apply\` in deploy/opentofu first, then run this from that dir so
\`tofu output -json\` resolves.
`);
  runtime.exit(1);
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

/**
 * Map parsed OpenTofu outputs to the wrangler placeholder strings for one
 * environment. Accepts either the `tofu output -json` envelope shape
 * (`name -> { value, sensitive, type }`) or Takosumi release output shape
 * (`name -> rawValue`). Throws if a required Cloudflare output is missing.
 */
export function buildReplacements(
  outputs,
  env,
  { zoneId, accountIdOverride } = {},
) {
  if (!ENVIRONMENTS.includes(env)) {
    throw new Error(`Unknown environment "${env}"`);
  }
  const read = (name) => {
    const entry = outputs[name];
    const value = outputValue(entry);
    if (value == null) {
      throw new Error(
        `tofu output "${name}" is missing or null. Did you \`tofu apply\` the cloudflare target first?`,
      );
    }
    return value;
  };

  const accountId = accountIdOverride?.trim() || read("cloudflare_account_id");
  const workerName = read("worker_name");
  const publicUrl = optionalPublicUrl(outputs);
  const d1 = read("cloudflare_d1_database_ids"); // { db }
  const kv = read("cloudflare_kv_namespace_ids"); // { hostname_routing, rollout_health }
  const r2 = read("object_storage_buckets");
  const queues = read("queue_bindings");
  const vectorizeIndexName = read("cloudflare_vectorize_index_name");
  const requireKey = (obj, key, outputName) => {
    if (obj[key] == null) {
      throw new Error(`tofu output "${outputName}" has no "${key}" key`);
    }
    return obj[key];
  };

  // placeholder string in wrangler.toml -> resolved value
  const prefix = env === "staging" ? "staging-" : "";
  const legacy = env === "staging" ? "takos-{name}-staging" : "takos-{name}";
  const oldWorkerName = env === "staging" ? "takos-staging" : "takos";
  const replacements = {
    [`"${oldWorkerName}"`]: tomlString(workerName),
    [`replace-with-${prefix}account-id`]: accountId,
    [`replace-with-${prefix}d1-database-id`]: requireKey(
      d1,
      "db",
      "cloudflare_d1_database_ids",
    ),
    [`replace-with-${prefix}hostname-routing-kv-namespace-id`]: requireKey(
      kv,
      "hostname_routing",
      "cloudflare_kv_namespace_ids",
    ),
    [`replace-with-${prefix}rollout-health-kv-namespace-id`]: requireKey(
      kv,
      "rollout_health",
      "cloudflare_kv_namespace_ids",
    ),
    [`"${legacy.replace("{name}", "worker-bundles")}"`]: tomlString(
      requireKey(r2, "worker_bundles", "object_storage_buckets"),
    ),
    [`"${legacy.replace("{name}", "tenant-builds")}"`]: tomlString(
      requireKey(r2, "tenant_builds", "object_storage_buckets"),
    ),
    [`"${legacy.replace("{name}", "tenant-source")}"`]: tomlString(
      requireKey(r2, "tenant_source", "object_storage_buckets"),
    ),
    [`"${legacy.replace("{name}", "git-objects")}"`]: tomlString(
      requireKey(r2, "git_objects", "object_storage_buckets"),
    ),
    [`"${legacy.replace("{name}", "offload")}"`]: tomlString(
      requireKey(r2, "offload", "object_storage_buckets"),
    ),
    [`"${legacy.replace("{name}", "runs")}"`]: tomlString(
      requireKey(queues, "runs", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "runs-dlq")}"`]: tomlString(
      requireKey(queues, "runs_dlq", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "index-jobs")}"`]: tomlString(
      requireKey(queues, "index_jobs", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "index-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "index_jobs_dlq", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "workflow-jobs")}"`]: tomlString(
      requireKey(queues, "workflow", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "workflow-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "workflow_dlq", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "deployment-jobs")}"`]: tomlString(
      requireKey(queues, "deployment", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "deployment-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "deployment_dlq", "queue_bindings"),
    ),
    [`"${legacy.replace("{name}", "embeddings")}"`]:
      tomlString(vectorizeIndexName),
  };
  if (zoneId) {
    replacements[`replace-with-${prefix}zone-id`] = zoneId;
  }
  if (publicUrl) {
    Object.assign(replacements, publicUrlReplacements(env, publicUrl));
  }
  if (env === "staging") {
    // Wrangler still reads the top-level account_id when deploying an env.
    // The staging-specific CF_ACCOUNT_ID var is not enough for API routes such
    // as D1 migrations, so render the base placeholder too.
    replacements["replace-with-account-id"] = accountId;
  }
  return replacements;
}

function optionalPublicUrl(outputs) {
  const value = outputValue(outputs.app_url) ?? outputValue(outputs.launch_url);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("tofu output app_url/launch_url must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("tofu output app_url/launch_url must be an https URL");
  }
  return parsed;
}

function publicUrlReplacements(env, url) {
  const host = url.hostname;
  if (env === "staging") {
    return {
      "staging-admin.example.com": host,
      "staging-app.example.com": host,
    };
  }
  return {
    "app.your-domain.example": host,
  };
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

function requireWorkerNameOutput(outputs) {
  const value = outputValue(outputs.worker_name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('tofu output "worker_name" is missing or empty');
  }
  return value.trim();
}

function wranglerTargetSection(toml, env) {
  if (env === "production") {
    return toml.split(/\n\[env\.staging\]\n/u)[0] ?? toml;
  }
  const marker = "\n[env.staging]\n";
  const index = toml.indexOf(marker);
  if (index < 0) {
    throw new Error("wrangler.toml is missing [env.staging]");
  }
  return toml.slice(index + 1);
}

function findTakosEgressService(section, env) {
  const header =
    env === "staging" ? "[[env.staging.services]]" : "[[services]]";
  for (const block of section.split(/\n(?=\[)/u)) {
    if (!block.startsWith(header)) continue;
    if (!/^\s*binding\s*=\s*"TAKOS_EGRESS"\s*$/mu.test(block)) continue;
    return block.match(/^\s*service\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  }
  return undefined;
}

export function assertRenderedWorkerTarget(toml, env, workerName) {
  const section = wranglerTargetSection(toml, env);
  const renderedName = section.match(/^\s*name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  if (renderedName !== workerName) {
    throw new Error(
      `rendered wrangler ${env} worker name mismatch: expected ${JSON.stringify(
        workerName,
      )}, got ${JSON.stringify(renderedName ?? null)}`,
    );
  }

  const egressService = findTakosEgressService(section, env);
  if (egressService !== workerName) {
    throw new Error(
      `rendered wrangler ${env} TAKOS_EGRESS service mismatch: expected ${JSON.stringify(
        workerName,
      )}, got ${JSON.stringify(egressService ?? null)}`,
    );
  }
}

function outputValue(entry) {
  if (entry == null) return undefined;
  if (
    typeof entry === "object" &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive")
  ) {
    return entry.value;
  }
  return entry;
}

export function parseTakosumiOutputsJson(text) {
  const outputs = JSON.parse(text);
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON must be a JSON object");
  }
  return outputs;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  let zoneId;
  let outPath;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--zone-id") {
      zoneId = argv[i + 1];
      if (!zoneId || zoneId.startsWith("--")) {
        fail("Error: --zone-id requires a value.");
      }
      i += 1;
    } else if (arg === "--out") {
      outPath = argv[i + 1];
      if (!outPath || outPath.startsWith("--")) {
        fail("Error: --out requires a value.");
      }
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
    fail(
      `Error: unknown environment "${env}". Valid: ${ENVIRONMENTS.join(", ")}`,
    );
  }
  return { env, zoneId, outPath, dryRun };
}

function readTofuOutputs() {
  const json = execSync("tofu output -json", { encoding: "utf8" });
  return JSON.parse(json);
}

function readOutputs() {
  const releaseOutputs = process.env.TAKOSUMI_OUTPUTS_JSON;
  if (releaseOutputs?.trim()) {
    return parseTakosumiOutputsJson(releaseOutputs);
  }
  return readTofuOutputs();
}

export function main(argv = process.argv.slice(2)) {
  const { env, zoneId, outPath, dryRun } = parseArgs(argv);
  const outputs = readOutputs();
  const workerName = requireWorkerNameOutput(outputs);
  const replacements = buildReplacements(outputs, env, {
    zoneId,
    accountIdOverride: process.env.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID,
  });
  const targetPath = outPath ? resolve(outPath) : WRANGLER_CONFIG;
  const toml = readFileSync(WRANGLER_CONFIG, "utf8");
  const {
    toml: next,
    applied,
    missing,
  } = applyReplacements(toml, replacements);
  assertRenderedWorkerTarget(next, env, workerName);

  for (const { placeholder, value } of applied) {
    console.log(`  ${placeholder} -> ${value}`);
  }
  if (missing.length > 0) {
    console.log(
      `\nAlready filled (placeholder not found, skipped): ${missing.join(", ")}`,
    );
  }
  if (!zoneId) {
    const zonePlaceholder =
      env === "staging"
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
    console.log(`\n--dry-run: ${targetPath} not written.`);
    return;
  }
  writeFileSync(targetPath, next);
  console.log(`\nWrote ${applied.length} replacement(s) to ${targetPath}.`);
}

if (import.meta.main) {
  main();
}
