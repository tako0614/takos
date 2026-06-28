#!/usr/bin/env bun
import * as runtime from "../runtime.ts";
// Guided self-host last-mile for a Takos distribution worker.
//
// The Cloudflare self-host runbook (deploy/TAKOSUMI_DEPLOY.md) is ~7 manual
// phases: tofu init/apply -> render wrangler bindings -> create the Vectorize
// index out of band -> build assets + containers -> two migration systems
// (wrangler d1 + accounts migrate-d1) -> push runtime secrets -> deploy the
// Worker artifact. This wraps them into one ordered, guided command that
// reuses the existing control scripts in this directory.
//
// Usage:
//   bun scripts/control/selfhost-bootstrap.mjs [environment] [flags]
//
// Environment: production (default) | staging.
//
// Flags:
//   --account-id <id>           Cloudflare account id (required for a real run).
//   --zone-id <id>              DNS zone id for custom-domain routes (optional;
//                               the OpenTofu module does not manage your zone).
//   --vectorize-index <name>    Vectorize index name (default takos-embeddings,
//                               takos-embeddings-staging for staging).
//   --vectorize-dimensions <n>  Embedding dimensions (default 768).
//   --vectorize-metric <m>      Distance metric (default cosine).
//   --takosumi-repo-dir <path>  Sibling Takosumi checkout (default ../takosumi).
//   --skip-provision            Skip the tofu init/apply + render phases
//                               (infra already provisioned, wrangler.toml filled).
//   --skip-migrations           Skip the D1 + accounts migration phase.
//   --skip-secrets              Skip pushing generated runtime secrets.
//   --dry-run                   Print the ordered command list without running.
//
// Each command is run from the printed working directory. The run stops on the
// first non-zero exit so you can fix the environment and re-run; the underlying
// control scripts (render, vectorize, secrets) are idempotent.

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const ENVIRONMENTS = ["production", "staging"];
const WRANGLER_CONFIG = "deploy/cloudflare/wrangler.toml";
const OPENTOFU_DIR = "deploy/opentofu";

// Feature-gated secrets are operator-provided (upstream OAuth, Stripe, OCI,
// passkeys). The bootstrap generates the always-required runtime secrets via
// ensure-release-secrets.mjs and only reminds the operator about these.
const FEATURE_GATED_SECRETS = [
  "OCI_ORCHESTRATOR_TOKEN",
  "CF_API_TOKEN",
  "TAKOSUMI_ACCOUNTS_STRIPE_SECRET_KEY",
  "TAKOSUMI_ACCOUNTS_STRIPE_WEBHOOK_SECRET",
  "TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_CLIENT_ID",
  "TAKOSUMI_ACCOUNTS_UPSTREAM_GOOGLE_CLIENT_SECRET",
  "TAKOSUMI_ACCOUNTS_UPSTREAM_OIDC_CLIENT_ID",
  "TAKOSUMI_ACCOUNTS_UPSTREAM_OIDC_CLIENT_SECRET",
  "TAKOSUMI_ACCOUNTS_PASSKEY_RP_ID",
  "TAKOSUMI_ACCOUNTS_PASSKEY_RP_NAME",
  "TAKOSUMI_ACCOUNTS_PASSKEY_ORIGIN",
];

function usage() {
  console.error(`
Usage: bun scripts/control/selfhost-bootstrap.mjs [environment] [flags]

Guided self-host last mile for a Takos distribution worker. Wraps the
deploy/TAKOSUMI_DEPLOY.md runbook into one ordered, guided command.

Environment:
  production     Base Wrangler config (default).
  staging        [env.staging] overlay.

Flags:
  --account-id <id>           Cloudflare account id (required for a real run).
  --zone-id <id>              DNS zone id for custom-domain routes (optional).
  --vectorize-index <name>    Vectorize index name (default per environment).
  --vectorize-dimensions <n>  Embedding dimensions (default 768).
  --vectorize-metric <m>      Distance metric (default cosine).
  --takosumi-repo-dir <path>  Sibling Takosumi checkout (default ../takosumi).
  --skip-provision            Skip the tofu apply + render phases.
  --skip-migrations           Skip the D1 + accounts migration phase.
  --skip-secrets              Skip pushing generated runtime secrets.
  --dry-run                   Print the ordered command list without running.
`);
  runtime.exit(1);
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function commandLine(parts) {
  return parts.map(shellArg).join(" ");
}

export function parseBootstrapArgs(argv = process.argv.slice(2)) {
  const positional = [];
  const options = {
    zoneId: undefined,
    accountId: undefined,
    vectorizeIndex: undefined,
    vectorizeDimensions: "768",
    vectorizeMetric: "cosine",
    takosumiRepoDir: "../takosumi",
    skipProvision: false,
    skipMigrations: false,
    skipSecrets: false,
    dryRun: false,
  };
  const valueFlags = {
    "--account-id": "accountId",
    "--zone-id": "zoneId",
    "--vectorize-index": "vectorizeIndex",
    "--vectorize-dimensions": "vectorizeDimensions",
    "--vectorize-metric": "vectorizeMetric",
    "--takosumi-repo-dir": "takosumiRepoDir",
  };
  const boolFlags = {
    "--skip-provision": "skipProvision",
    "--skip-migrations": "skipMigrations",
    "--skip-secrets": "skipSecrets",
    "--dry-run": "dryRun",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg in valueFlags) {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) {
        fail(`Error: flag "${arg}" requires a value.`);
      }
      options[valueFlags[arg]] = value;
      i += 1;
    } else if (arg in boolFlags) {
      options[boolFlags[arg]] = true;
    } else if (arg.startsWith("--")) {
      fail(`Error: unknown flag "${arg}".`);
    } else {
      positional.push(arg);
    }
  }
  const environment = positional[0] ?? "production";
  if (positional.length > 1) {
    fail(`Error: unexpected argument "${positional[1]}".`);
  }
  if (!ENVIRONMENTS.includes(environment)) {
    fail(
      `Error: unknown environment "${environment}". Valid: ${ENVIRONMENTS.join(", ")}`,
    );
  }
  return { environment, ...options };
}

/**
 * Build the ordered bootstrap plan as a list of phases. Pure: it computes the
 * exact commands without provisioning anything, so --dry-run can print them and
 * tests can assert the order. Placeholders (`<account-id>`, `<zone-id>`) are
 * substituted when the corresponding flag is omitted so the preview stays
 * runnable to read.
 */
export function buildBootstrapPlan(options) {
  const {
    environment,
    accountId,
    zoneId,
    vectorizeIndex,
    vectorizeDimensions = "768",
    vectorizeMetric = "cosine",
    takosumiRepoDir = "../takosumi",
    skipProvision = false,
    skipMigrations = false,
    skipSecrets = false,
  } = options;
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}"`);
  }
  const account = accountId ?? "<account-id>";
  const wranglerEnvArgs = environment === "staging" ? ["--env", "staging"] : [];
  const defaultIndex =
    environment === "staging" ? "takos-embeddings-staging" : "takos-embeddings";
  const indexName = vectorizeIndex ?? defaultIndex;
  const phases = [];

  if (!skipProvision) {
    phases.push({
      id: "provision",
      title: "Provision durable infra (OpenTofu)",
      cwd: OPENTOFU_DIR,
      commands: [
        "tofu init",
        commandLine([
          "tofu",
          "apply",
          "-var",
          "target=cloudflare",
          "-var",
          `cloudflare={account_id="${account}"}`,
        ]),
      ],
    });
    phases.push({
      id: "render-wrangler",
      title: "Render wrangler bindings from tofu outputs",
      // Run from the module dir so the render script's `tofu output -json` resolves.
      cwd: OPENTOFU_DIR,
      commands: [
        commandLine([
          "bun",
          "../../scripts/control/render-wrangler-from-tofu.mjs",
          environment,
          ...(zoneId ? ["--zone-id", zoneId] : []),
        ]),
      ],
    });
  }

  phases.push({
    id: "vectorize",
    title: "Create the Vectorize index (out of band)",
    cwd: ".",
    commands: [
      commandLine([
        "bun",
        "scripts/control/ensure-vectorize-index.mjs",
        indexName,
        "--dimensions",
        String(vectorizeDimensions),
        "--metric",
        vectorizeMetric,
      ]),
    ],
  });

  phases.push({
    id: "build",
    title: "Build SPA assets and containers",
    cwd: ".",
    commands: ["bun run build", "bun run containers:build"],
  });

  if (!skipMigrations) {
    phases.push({
      id: "migrate",
      title: "Run product activation (D1 + accounts migrations)",
      cwd: ".",
      commands: [
        commandLine([
          "bunx",
          "wrangler",
          "d1",
          "migrations",
          "apply",
          "DB",
          "--remote",
          "--config",
          WRANGLER_CONFIG,
          ...wranglerEnvArgs,
        ]),
        commandLine([
          "bun",
          "run",
          "--cwd",
          takosumiRepoDir,
          "cli",
          "--",
          "accounts",
          "migrate-d1",
          "--database-id",
          "TAKOSUMI_ACCOUNTS_DB",
          "--wrangler-config",
          resolve(WRANGLER_CONFIG),
          "--account-id",
          account,
          "--remote",
          ...wranglerEnvArgs,
        ]),
      ],
    });
  }

  if (!skipSecrets) {
    phases.push({
      id: "secrets",
      title: "Push generated runtime secrets",
      cwd: ".",
      commands: [
        commandLine([
          "bun",
          "scripts/control/ensure-release-secrets.mjs",
          environment,
          "--config",
          WRANGLER_CONFIG,
        ]),
      ],
      note:
        "Feature-gated secrets are operator-provided; set the ones you use with " +
        `\`bunx wrangler secret put <NAME> --config ${WRANGLER_CONFIG}` +
        `${wranglerEnvArgs.length ? " " + wranglerEnvArgs.join(" ") : ""}\`: ` +
        FEATURE_GATED_SECRETS.join(", "),
    });
  }

  phases.push({
    id: "deploy",
    title: "Deploy the Worker artifact",
    cwd: ".",
    commands: [
      commandLine([
        "bunx",
        "wrangler",
        "deploy",
        "--config",
        WRANGLER_CONFIG,
        ...wranglerEnvArgs,
      ]),
    ],
  });

  return phases;
}

export function formatPlan(phases) {
  const lines = [];
  let step = 0;
  phases.forEach((phase, index) => {
    lines.push(`${index + 1}. ${phase.title}`);
    for (const command of phase.commands) {
      step += 1;
      const prefix = phase.cwd && phase.cwd !== "." ? `cd ${phase.cwd} && ` : "";
      lines.push(`   [${step}] ${prefix}${command}`);
    }
    if (phase.note) lines.push(`   note: ${phase.note}`);
  });
  return lines.join("\n");
}

function run(command, cwd) {
  const prefix = cwd && cwd !== "." ? `(cwd: ${cwd}) ` : "";
  console.log(`\n> ${prefix}${command}\n`);
  execSync(command, {
    stdio: "inherit",
    cwd: cwd && cwd !== "." ? resolve(cwd) : process.cwd(),
  });
}

export function main(argv = process.argv.slice(2)) {
  const options = parseBootstrapArgs(argv);
  const phases = buildBootstrapPlan(options);

  if (options.dryRun) {
    console.log(
      `Takos self-host bootstrap plan (${options.environment})${options.accountId ? "" : " [preview: pass --account-id for a real run]"}:\n`,
    );
    console.log(formatPlan(phases));
    console.log("\n--dry-run: nothing executed.");
    return;
  }

  if (!options.accountId) {
    fail("Error: --account-id is required for a real run (use --dry-run to preview).");
  }

  for (const phase of phases) {
    console.log(`\n=== ${phase.title} ===`);
    for (const command of phase.commands) {
      run(command, phase.cwd);
    }
    if (phase.note) console.log(`\nNote: ${phase.note}`);
  }
  console.log(
    `\nTakos self-host bootstrap completed for ${options.environment}.`,
  );
}

if (import.meta.main) {
  main();
}
