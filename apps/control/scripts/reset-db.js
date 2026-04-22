#!/usr/bin/env node

/**
 * Remote DB Reset Script
 * Resets remote D1 databases (staging/production) by deleting rows.
 * For local reset, use the local stack/bootstrap flow (`deno task local:up`);
 * this script is for staging/production only.
 *
 * Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]
 */

import { spawnSync } from "child_process";
import readline from "readline";

const args = process.argv.slice(2);
const includeAccounts = args.includes("--include-accounts");

let env = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--include-accounts") continue;
  if (arg === "--env") {
    const value = args[i + 1];
    if (value !== "staging" && value !== "production") {
      printUsage();
      process.exit(1);
    }
    env = value;
    i += 1;
    continue;
  }
  printUsage();
  process.exit(1);
}

if (!env) {
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(
    "Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]",
  );
  console.log("  --env staging       Reset staging remote database");
  console.log("  --env production    Reset production remote database");
  console.log("  --include-accounts  Also delete accounts table");
  console.log("");
  console.log(
    "For local reset, use the local stack/bootstrap flow (`deno task local:up`); this script is for staging/production only.",
  );
}

// Canonical table inventory in child-first order.
// `accounts` is preserved by default (the identity root table).
const TABLES = [
  // Workflow / repository leaf tables
  "file_handler_matchers",
  "workflow_steps",
  "workflow_jobs",
  "workflow_artifacts",
  "workflow_runs",
  "workflow_secrets",
  "workflows",
  "tenant_workflow_instances",
  "pr_comments",
  "pr_reviews",
  "pull_requests",
  "repo_release_assets",
  "repo_releases",
  "repo_stars",
  "repo_forks",
  "repo_grants",
  "repo_push_activities",
  "repo_remotes",
  "tags",
  "commits",
  "branches",
  "git_file_changes",
  "git_commits",

  // Session / runtime leaf tables
  "session_files",
  "session_repos",
  "lg_writes",
  "lg_checkpoints",

  // UI / app surface
  "shortcut_group_items",
  "shortcut_groups",
  "shortcuts",
  "ui_extensions",
  "skills",
  "apps",

  // Threads / runs / memory / indexing
  "run_events",
  "artifacts",
  "agent_tasks",
  "messages",
  "thread_shares",
  "info_units",
  "reminders",
  "memory_claim_edges",
  "memory_evidence",
  "memory_paths",
  "memory_claims",
  "memories",
  "chunks",
  "edges",
  "nodes",
  "index_jobs",
  "runs",
  "tool_operations",

  // Auth / OAuth
  "oauth_tokens",
  "oauth_device_codes",
  "oauth_authorization_codes",
  "oauth_consents",
  "oauth_audit_logs",
  "oauth_clients",
  "oauth_states",
  "auth_sessions",
  "auth_identities",
  "auth_services",
  "personal_access_tokens",
  "service_tokens",

  // Notifications / moderation / social / billing
  "notification_preferences",
  "notification_settings",
  "notifications",
  "moderation_audit_logs",
  "reports",
  "account_moderation",
  "account_follow_requests",
  "account_blocks",
  "account_mutes",
  "account_follows",
  "ap_followers",
  "account_settings",
  "usage_events",
  "usage_rollups",
  "billing_transactions",
  "billing_accounts",
  "billing_plan_features",
  "billing_plan_quotas",
  "billing_plan_rates",
  "billing_plans",
  "stripe_webhook_events",
  "ap_delivery_queue",

  // Worker / deploy / resource / package
  "publications",
  "service_consumes",
  "service_bindings",
  "service_common_env_links",
  "service_env_vars",
  "service_mcp_endpoints",
  "service_runtime_flags",
  "service_runtime_limits",
  "service_runtime_settings",
  "service_runtimes",
  "worker_mcp_endpoints",
  "worker_runtime_limits",
  "worker_runtime_flags",
  "worker_common_env_links",
  "worker_env_vars",
  "managed_takos_tokens",
  "common_env_reconcile_jobs",
  "common_env_audit_logs",
  "worker_bindings",
  "resource_access_tokens",
  "resource_access",
  "mcp_servers",
  "mcp_oauth_pending",
  "infra_endpoint_routes",
  "infra_endpoints",
  "infra_workers",
  "file_handlers",
  "bundle_deployment_events",
  "resources",
  "worker_runtime_settings",
  "deployment_events",
  "custom_domains",
  "deployments",
  "services",
  "workers",
  "bundle_deployments",
  "store_inventory_items",
  "store_registry_updates",
  "store_registry",
  "group_deployment_snapshots",
  "groups",
  "default_app_preinstall_jobs",
  "default_app_distribution_entries",
  "default_app_distribution_config",

  // Files / repositories / account hierarchy
  "files",
  "blobs",
  "snapshots",
  "sessions",
  "repositories",
  "account_metadata",
  "account_storage_files",
  "account_memberships",
  "account_env_vars",
  "account_stats",
  "threads",
];

// `accounts` is the identity root — preserved by default.
const ACCOUNT_TABLE = "accounts";
const PRESERVED_WITH_ACCOUNTS = new Set([
  "auth_identities",
]);

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

function executeSql(sql) {
  const result = spawnSync("npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--env",
    env,
    "--command",
    sql,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const message =
      (result.stderr || result.stdout || `exit code ${result.status ?? 1}`)
        .trim();
    throw new Error(message);
  }
}

async function main() {
  console.log(`Resetting database (remote:${env})...`);
  if (includeAccounts) {
    console.log("This will DELETE ALL data INCLUDING the accounts table.");
  } else {
    console.log(
      "This will DELETE all data except accounts and auth identity rows.",
    );
  }

  const confirmed = await confirm("Are you sure? (y/N): ");
  if (!confirmed) {
    console.log("Cancelled.");
    process.exit(0);
  }

  console.log("");

  const tablesToDelete = includeAccounts
    ? [...TABLES, ACCOUNT_TABLE]
    : TABLES.filter((table) => !PRESERVED_WITH_ACCOUNTS.has(table));
  const runStep = (label, sql) => {
    process.stdout.write(`${label}... `);
    try {
      executeSql(sql);
      console.log("OK");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingTablePattern = new RegExp(
        `no such table:\\s+(?:main\\.)?${
          label.replace(/^Deleting from /, "")
        }\\b`,
        "i",
      );
      if (missingTablePattern.test(message)) {
        console.log("(skipped)");
        return;
      }
      console.log("FAILED");
      throw error;
    }
  };

  for (const table of tablesToDelete) {
    runStep(`Deleting from ${table}`, `DELETE FROM ${table};`);
  }

  console.log("");
  console.log("Done! Database reset complete.");
  if (includeAccounts) {
    console.log("All tables deleted including accounts.");
  } else {
    console.log(
      "Accounts and auth identities preserved; all other data removed.",
    );
  }
}

main().catch(console.error);
