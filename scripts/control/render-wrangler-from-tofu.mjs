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
// What it fills (per environment): service runtime name, CF_ACCOUNT_ID, SQL
// database ids, key-value store ids, object bucket names, queue names, and
// vector index name. CF_ZONE_ID is NOT a module-managed resource (it is the
// self-hoster's existing DNS zone), so pass it with --zone-id or fill the
// remaining `replace-with-*zone-id` placeholder by hand. Container images, SPA
// build, secrets, and D1 migrations are handled by the release command.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ENVIRONMENTS = ["production", "staging"];
const CONTAINER_APP_NAME_SUFFIX_BY_CLASS = {
  TakosRuntimeContainer: "runtime",
  ExecutorContainerTier1: "executor-tier1",
  ExecutorContainerTier2: "executor-tier2",
  ExecutorContainerTier3: "executor-tier3",
};
const CONTAINER_CAPACITY_KEY_BY_CLASS = {
  TakosRuntimeContainer: "runtime_max_instances",
  ExecutorContainerTier1: "tier1_max_instances",
  ExecutorContainerTier2: "tier2_max_instances",
  ExecutorContainerTier3: "tier3_max_instances",
};
const EXECUTOR_ENV_KEY_BY_CAPACITY_KEY = {
  tier1_max_instances: "EXECUTOR_TIER1_WARM_POOL_SIZE",
  tier1_max_concurrent_runs: "EXECUTOR_TIER1_MAX_CONCURRENT_RUNS",
  tier3_max_instances: "EXECUTOR_TIER3_POOL_SIZE",
  tier3_max_concurrent_runs: "EXECUTOR_TIER3_MAX_CONCURRENT_RUNS",
};

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
  const workerName = read("service_runtime_name");
  const publicUrl = optionalPublicUrl(outputs);
  const d1 = readFirstOutput(outputs, [
    "sql_databases",
    "cloudflare_d1_database_ids",
  ]); // { db }
  const kv = readFirstOutput(outputs, [
    "key_value_stores",
    "cloudflare_kv_namespace_ids",
  ]); // { hostname_routing, rollout_health }
  const r2 = read("object_buckets");
  const queues = read("queues");
  const vectorizeIndexName = readVectorIndexName(outputs);
  const deploymentEnv = appDeploymentEnv(outputs);
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
      "sql_databases/cloudflare_d1_database_ids",
    ),
    [`replace-with-${prefix}hostname-routing-kv-namespace-id`]: requireKey(
      kv,
      "hostname_routing",
      "key_value_stores/cloudflare_kv_namespace_ids",
    ),
    [`replace-with-${prefix}rollout-health-kv-namespace-id`]: requireKey(
      kv,
      "rollout_health",
      "key_value_stores/cloudflare_kv_namespace_ids",
    ),
    [`"${legacy.replace("{name}", "worker-bundles")}"`]: tomlString(
      requireKey(r2, "worker_bundles", "object_buckets"),
    ),
    [`"${legacy.replace("{name}", "tenant-builds")}"`]: tomlString(
      requireKey(r2, "tenant_builds", "object_buckets"),
    ),
    [`"${legacy.replace("{name}", "tenant-source")}"`]: tomlString(
      requireKey(r2, "tenant_source", "object_buckets"),
    ),
    [`"${legacy.replace("{name}", "git-objects")}"`]: tomlString(
      requireKey(r2, "git_objects", "object_buckets"),
    ),
    [`"${legacy.replace("{name}", "offload")}"`]: tomlString(
      requireKey(r2, "offload", "object_buckets"),
    ),
    [`"${legacy.replace("{name}", "runs")}"`]: tomlString(
      requireKey(queues, "runs", "queues"),
    ),
    [`"${legacy.replace("{name}", "runs-dlq")}"`]: tomlString(
      requireKey(queues, "runs_dlq", "queues"),
    ),
    [`"${legacy.replace("{name}", "index-jobs")}"`]: tomlString(
      requireKey(queues, "index_jobs", "queues"),
    ),
    [`"${legacy.replace("{name}", "index-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "index_jobs_dlq", "queues"),
    ),
    [`"${legacy.replace("{name}", "workflow-jobs")}"`]: tomlString(
      requireKey(queues, "workflow", "queues"),
    ),
    [`"${legacy.replace("{name}", "workflow-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "workflow_dlq", "queues"),
    ),
    [`"${legacy.replace("{name}", "deployment-jobs")}"`]: tomlString(
      requireKey(queues, "deployment", "queues"),
    ),
    [`"${legacy.replace("{name}", "deployment-jobs-dlq")}"`]: tomlString(
      requireKey(queues, "deployment_dlq", "queues"),
    ),
    [`"${legacy.replace("{name}", "notification-push")}"`]: tomlString(
      requireKey(queues, "notification_push", "queues"),
    ),
    [`"${legacy.replace("{name}", "notification-push-dlq")}"`]: tomlString(
      requireKey(queues, "notification_push_dlq", "queues"),
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
  Object.assign(replacements, workerEnvReplacements(env, deploymentEnv));
  if (env === "staging") {
    // Wrangler still reads the top-level account_id when deploying an env.
    // The staging-specific CF_ACCOUNT_ID var is not enough for API routes such
    // as D1 migrations, so render the base placeholder too.
    replacements["replace-with-account-id"] = accountId;
  }
  return replacements;
}

function readFirstOutput(outputs, names) {
  for (const name of names) {
    const value = outputValue(outputs[name]);
    if (value != null) return value;
  }
  throw new Error(
    `tofu output "${names.join('" or "')}" is missing or null. Did you \`tofu apply\` the cloudflare target first?`,
  );
}

function readVectorIndexName(outputs) {
  const indexes = outputValue(outputs.vector_indexes);
  if (indexes && typeof indexes === "object" && !Array.isArray(indexes)) {
    for (const key of ["vector", "embeddings", "default"]) {
      const entry = indexes[key];
      if (typeof entry === "string" && entry.trim() !== "") return entry;
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof entry.name === "string" &&
        entry.name.trim() !== ""
      ) {
        return entry.name;
      }
    }
  }
  return readFirstOutput(outputs, [
    "cloudflare_vectorize_index_name",
    "vectorize_index_name",
  ]);
}

function appDeploymentEnv(outputs) {
  const appDeployment = outputValue(outputs.app_deployment);
  const env = appDeployment?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env).filter(
      ([, value]) => typeof value === "string" && value.trim() !== "",
    ),
  );
}

function workerEnvReplacements(env, deploymentEnv) {
  const replacements = {};
  const put = (placeholders, value) => {
    if (typeof value !== "string" || value.trim() === "") return;
    for (const placeholder of placeholders) {
      replacements[tomlString(placeholder)] = tomlString(value.trim());
    }
  };
  const accountsUrl =
    deploymentEnv.TAKOSUMI_ACCOUNTS_URL ?? deploymentEnv.OIDC_ISSUER_URL;
  const accountsPlaceholders =
    env === "staging"
      ? ["https://staging-app.takosumi.example"]
      : ["https://app.takosumi.example"];
  const clientIdPlaceholders =
    env === "staging"
      ? ["takos-staging-installation-client"]
      : ["takos-worker-installation-client"];
  const redirectPlaceholders =
    env === "staging"
      ? ["https://staging-admin.example.com/auth/oidc/callback"]
      : ["https://app.your-domain.example/auth/oidc/callback"];

  put(accountsPlaceholders, accountsUrl);
  put(clientIdPlaceholders, deploymentEnv.OIDC_CLIENT_ID);
  put(redirectPlaceholders, deploymentEnv.OIDC_REDIRECT_URI);
  return replacements;
}

function optionalPublicUrl(outputs) {
  const value =
    outputValue(outputs.public_url) ?? outputValue(outputs.launch_url);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("tofu output public_url/launch_url must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("tofu output public_url/launch_url must be an https URL");
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

function publicRouteForOutputs(outputs, zoneId) {
  const publicUrl = optionalPublicUrl(outputs);
  if (!publicUrl) return undefined;
  if (publicUrl.hostname.endsWith(".workers.dev")) return undefined;
  return {
    pattern: `${publicUrl.hostname}/*`,
    ...(zoneId ? { zoneId } : {}),
    ...(!zoneId ? { zoneName: zoneNameFromHostname(publicUrl.hostname) } : {}),
  };
}

function zoneNameFromHostname(hostname) {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return hostname;
  return labels.slice(-2).join(".");
}

const GENERATED_PUBLIC_ROUTE_BEGIN = "# BEGIN TAKOSUMI GENERATED PUBLIC ROUTE";
const GENERATED_PUBLIC_ROUTE_END = "# END TAKOSUMI GENERATED PUBLIC ROUTE";

function generatedPublicRouteBlock(env, route) {
  const routeFields = [
    `pattern = ${tomlString(route.pattern)}`,
    ...(route.zoneId ? [`zone_id = ${tomlString(route.zoneId)}`] : []),
    ...(!route.zoneId && route.zoneName
      ? [`zone_name = ${tomlString(route.zoneName)}`]
      : []),
  ].join(", ");
  return [
    GENERATED_PUBLIC_ROUTE_BEGIN,
    "# Generated from OpenTofu public_url/launch_url during Takos release activation.",
    "routes = [",
    `  { ${routeFields} },`,
    "]",
    GENERATED_PUBLIC_ROUTE_END,
  ].join("\n");
}

function stripGeneratedPublicRoutes(toml) {
  const pattern = new RegExp(
    `\\n?${GENERATED_PUBLIC_ROUTE_BEGIN.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[\\s\\S]*?${GENERATED_PUBLIC_ROUTE_END.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\n?`,
    "gu",
  );
  return toml.replace(pattern, "\n");
}

export function renderPublicRoute(toml, env, outputs, { zoneId } = {}) {
  const route = publicRouteForOutputs(outputs, zoneId);
  const withoutGeneratedRoutes = stripGeneratedPublicRoutes(toml);
  if (!route) return withoutGeneratedRoutes;

  const block = generatedPublicRouteBlock(env, route);
  if (env === "production") {
    return withoutGeneratedRoutes.replace(
      /^workers_dev\s*=\s*(?:true|false)\s*$/mu,
      (line) => `${line}\n\n${block}`,
    );
  }

  return withoutGeneratedRoutes.replace(
    /(\n\[env\.staging\]\n[\s\S]*?^workers_dev\s*=\s*(?:true|false)\s*$)/mu,
    (match) => `${match}\n\n${block}`,
  );
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

export function containerApplicationName(workerName, className) {
  const suffix = CONTAINER_APP_NAME_SUFFIX_BY_CLASS[className];
  if (!suffix) return undefined;
  return `${workerName}-${suffix}`;
}

function containerHeaderForEnv(env) {
  return env === "staging" ? "[[env.staging.containers]]" : "[[containers]]";
}

function isTomlHeader(line) {
  return /^\s*\[\[?[^\]]+\]\]?\s*$/u.test(line);
}

function renderContainerBlockName(lines, workerName) {
  const block = lines.join("\n");
  const className = block.match(/^\s*class_name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const appName = className
    ? containerApplicationName(workerName, className)
    : undefined;
  if (!appName) return lines;

  const nameLine = `name = ${tomlString(appName)}`;
  const rendered = [];
  let inserted = false;

  for (const line of lines) {
    if (/^\s*name\s*=/u.test(line)) {
      if (!inserted) {
        rendered.push(nameLine);
        inserted = true;
      }
      continue;
    }
    rendered.push(line);
    if (!inserted && /^\s*class_name\s*=/u.test(line)) {
      rendered.push(nameLine);
      inserted = true;
    }
  }

  if (!inserted) {
    rendered.splice(1, 0, nameLine);
  }

  return rendered;
}

function eachTomlBlock(toml, visit) {
  const lines = toml.split("\n");
  let block = { header: undefined, lines: [] };

  const flush = () => {
    if (!block || block.lines.length === 0) return;
    visit(block);
    block = undefined;
  };

  for (const line of lines) {
    if (isTomlHeader(line)) {
      flush();
      block = {
        header: line.trim(),
        lines: [line],
      };
      continue;
    }
    block ??= { header: undefined, lines: [] };
    block.lines.push(line);
  }
  flush();
}

function targetContainerBlocks(toml, env) {
  const targetHeader = containerHeaderForEnv(env);
  const blocks = [];
  eachTomlBlock(toml, (block) => {
    if (block.header === targetHeader) {
      blocks.push(block.lines);
    }
  });
  return blocks;
}

export function renderContainerApplicationNames(toml, env, workerName) {
  const targetHeader = containerHeaderForEnv(env);
  const rendered = [];

  eachTomlBlock(toml, (block) => {
    rendered.push(
      ...(block.header === targetHeader
        ? renderContainerBlockName(block.lines, workerName)
        : block.lines),
    );
  });

  return rendered.join("\n");
}

function executorCapacityFromOutputs(outputs) {
  const value = outputValue(outputs.executor_capacity);
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error('tofu output "executor_capacity" must be an object');
  }
  const required = [
    "runtime_max_instances",
    "tier1_max_instances",
    "tier1_max_concurrent_runs",
    "tier2_max_instances",
    "tier3_max_instances",
    "tier3_max_concurrent_runs",
  ];
  const capacity = {};
  for (const key of required) {
    const entry = value[key];
    if (!Number.isInteger(entry) || entry < 1 || entry > 500) {
      throw new Error(
        `tofu output "executor_capacity.${key}" must be a whole number between 1 and 500`,
      );
    }
    capacity[key] = entry;
  }
  return capacity;
}

function renderTomlAssignments(lines, assignments) {
  const remaining = new Map(Object.entries(assignments));
  const rendered = lines.map((line) => {
    const name = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/u)?.[1];
    if (!name || !remaining.has(name)) return line;
    const value = remaining.get(name);
    remaining.delete(name);
    return `${name} = ${tomlString(value)}`;
  });
  for (const [name, value] of remaining) {
    rendered.push(`${name} = ${tomlString(value)}`);
  }
  return rendered;
}

function renderContainerCapacityBlock(lines, capacity) {
  const className = lines
    .join("\n")
    .match(/^\s*class_name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const key = className
    ? CONTAINER_CAPACITY_KEY_BY_CLASS[className]
    : undefined;
  if (!key) return { lines, className: undefined };
  let replaced = false;
  const rendered = lines.map((line) => {
    if (!/^\s*max_instances\s*=/u.test(line)) return line;
    replaced = true;
    return `max_instances = ${capacity[key]}`;
  });
  if (!replaced) rendered.push(`max_instances = ${capacity[key]}`);
  return { lines: rendered, className };
}

function renderRunQueueCapacityBlock(lines, queueName, maxConcurrency) {
  const block = lines.join("\n");
  const configuredQueue = block.match(/^\s*queue\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  if (configuredQueue !== queueName) return { lines, matched: false };
  let replaced = false;
  const rendered = lines.map((line) => {
    if (!/^\s*max_concurrency\s*=/u.test(line)) return line;
    replaced = true;
    return `max_concurrency = ${maxConcurrency}`;
  });
  if (!replaced) rendered.push(`max_concurrency = ${maxConcurrency}`);
  return { lines: rendered, matched: true };
}

export function renderExecutorCapacity(toml, env, outputs) {
  const capacity = executorCapacityFromOutputs(outputs);
  if (!capacity) return toml;
  const containerHeader = containerHeaderForEnv(env);
  const varsHeader = env === "staging" ? "[env.staging.vars]" : "[vars]";
  const queueHeader =
    env === "staging"
      ? "[[env.staging.queues.consumers]]"
      : "[[queues.consumers]]";
  const queueOutputs = outputValue(outputs.queues);
  const runQueueName =
    queueOutputs &&
    typeof queueOutputs === "object" &&
    !Array.isArray(queueOutputs) &&
    typeof queueOutputs.runs === "string"
      ? queueOutputs.runs
      : undefined;
  const runQueueMaxConcurrency =
    capacity.tier1_max_instances * capacity.tier1_max_concurrent_runs +
    capacity.tier3_max_instances * capacity.tier3_max_concurrent_runs;
  const executorEnv = Object.fromEntries(
    Object.entries(EXECUTOR_ENV_KEY_BY_CAPACITY_KEY).map(
      ([capacityKey, envName]) => [envName, String(capacity[capacityKey])],
    ),
  );
  const rendered = [];
  const renderedClasses = new Set();
  let renderedVars = false;
  let renderedRunQueue = false;

  eachTomlBlock(toml, (block) => {
    if (block.header === containerHeader) {
      const result = renderContainerCapacityBlock(block.lines, capacity);
      if (result.className) renderedClasses.add(result.className);
      rendered.push(...result.lines);
      return;
    }
    if (block.header === varsHeader) {
      renderedVars = true;
      rendered.push(...renderTomlAssignments(block.lines, executorEnv));
      return;
    }
    if (runQueueName && block.header === queueHeader) {
      const result = renderRunQueueCapacityBlock(
        block.lines,
        runQueueName,
        runQueueMaxConcurrency,
      );
      renderedRunQueue ||= result.matched;
      rendered.push(...result.lines);
      return;
    }
    rendered.push(...block.lines);
  });

  if (!renderedVars) {
    throw new Error(`wrangler.toml is missing ${varsHeader}`);
  }
  const missingClasses = Object.keys(CONTAINER_CAPACITY_KEY_BY_CLASS).filter(
    (className) => !renderedClasses.has(className),
  );
  if (missingClasses.length > 0) {
    throw new Error(
      `wrangler.toml is missing ${env} container capacity block(s): ${missingClasses.join(", ")}`,
    );
  }
  if (runQueueName && !renderedRunQueue) {
    throw new Error(
      `wrangler.toml is missing ${env} run queue consumer ${runQueueName}`,
    );
  }
  return rendered.join("\n");
}

function requireWorkerNameOutput(outputs) {
  const value = outputValue(outputs.service_runtime_name);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('tofu output "service_runtime_name" is missing or empty');
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

  for (const lines of targetContainerBlocks(section, env)) {
    const block = lines.join("\n");
    const className = block.match(/^\s*class_name\s*=\s*"([^"]+)"\s*$/mu)?.[1];
    if (!className || !CONTAINER_APP_NAME_SUFFIX_BY_CLASS[className]) continue;
    const expectedName = containerApplicationName(workerName, className);
    const renderedContainerName = block.match(
      /^\s*name\s*=\s*"([^"]+)"\s*$/mu,
    )?.[1];
    if (renderedContainerName !== expectedName) {
      throw new Error(
        `rendered wrangler ${env} container ${className} name mismatch: expected ${JSON.stringify(
          expectedName,
        )}, got ${JSON.stringify(renderedContainerName ?? null)}`,
      );
    }
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
  const renderedToml = renderContainerApplicationNames(next, env, workerName);
  const capacityToml = renderExecutorCapacity(renderedToml, env, outputs);
  const routedToml = renderPublicRoute(capacityToml, env, outputs, { zoneId });
  assertRenderedWorkerTarget(routedToml, env, workerName);

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
    if (routedToml.includes(zonePlaceholder)) {
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
  writeFileSync(targetPath, routedToml);
  console.log(`\nWrote ${applied.length} replacement(s) to ${targetPath}.`);
}

if (import.meta.main) {
  main();
}
