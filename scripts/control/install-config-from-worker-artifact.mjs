#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { lifecycleConfigFromWorkerArtifact } from "./lifecycle-config-from-worker-artifact.mjs";

function usage() {
  console.error(
    "Usage: bun scripts/control/install-config-from-worker-artifact.mjs <takosumi-artifact.json> [--output <path>] [--environment <name>] [--executor runner|operator] [--rollout immediate|gradual|none]",
  );
  process.exit(2);
}

export function parseArgs(argv) {
  let manifestPath = null;
  let output = null;
  let environment = "production";
  let executor = "operator";
  let rollout = "immediate";

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index] ?? null;
      if (!output) usage();
      continue;
    }
    if (value === "--environment") {
      environment = argv[++index] ?? "";
      if (!environment) usage();
      continue;
    }
    if (value === "--executor") {
      executor = argv[++index] ?? "";
      if (executor !== "runner" && executor !== "operator") usage();
      continue;
    }
    if (value === "--rollout") {
      rollout = argv[++index] ?? "";
      if (!["immediate", "gradual", "none"].includes(rollout)) usage();
      continue;
    }
    if (value.startsWith("--") || manifestPath !== null) usage();
    manifestPath = value;
  }

  if (!manifestPath) usage();
  return { manifestPath, output, environment, executor, rollout };
}

function requiredOutput(from, type) {
  return { from, type, required: true };
}

/**
 * Produce the versioned, service-side Takos InstallConfig contribution for an
 * immutable Worker release. This patch is operator DB input. It is not Store
 * metadata, a repository manifest, or a reserved OpenTofu Output schema.
 */
export function installConfigFromWorkerArtifact(manifest, options = {}) {
  const lifecycle = lifecycleConfigFromWorkerArtifact(manifest, options);

  return {
    kind: "takosumi.install-config-patch@v1",
    variableMapping: { target: "cloudflare" },
    variablePresentation: [
      {
        name: "project_name",
        type: "string",
        format: "subdomain",
        required: true,
        defaultValue: { source: "capsule_name" },
        label: { ja: "リソース名", en: "Resource name" },
        helper: {
          ja: "この Takos Capsule が作成するリソースの名前です。",
          en: "Name prefix for resources created by this Takos Capsule.",
        },
      },
      {
        name: "public_subdomain",
        type: "string",
        format: "subdomain",
        required: true,
        defaultValue: { source: "capsule_name" },
        advanced: true,
        label: { ja: "公開名", en: "Public name" },
      },
      {
        name: "public_url",
        type: "string",
        format: "url",
        advanced: true,
        label: { ja: "公開 URL", en: "Public URL" },
      },
    ],
    installExperience: {
      projections: [
        { kind: "service_name", variable: "project_name" },
        {
          kind: "public_endpoint",
          variables: {
            subdomain: "public_subdomain",
            url: "public_url",
          },
          baseDomain: "app.takos.jp",
        },
        {
          kind: "oidc_client",
          variables: {
            accountsUrl: "takosumi_accounts_url",
            issuerUrl: "takosumi_accounts_issuer_url",
            clientId: "takosumi_accounts_client_id",
            redirectUri: "takosumi_accounts_redirect_uri",
          },
          callbackPath: "/auth/oidc/callback",
          scopes: ["openid", "profile", "email"],
        },
      ],
    },
    outputAllowlist: {
      launch_url: requiredOutput("launch_url", "url"),
      cloudflare_account_id: requiredOutput("cloudflare_account_id", "string"),
      service_runtime_name: requiredOutput("service_runtime_name", "string"),
      executor_capacity: requiredOutput("executor_capacity", "json"),
      worker_env: requiredOutput("worker_env", "json"),
      sql_databases: requiredOutput("sql_databases", "json"),
      key_value_stores: requiredOutput("key_value_stores", "json"),
      vector_indexes: requiredOutput("vector_indexes", "json"),
      object_buckets: requiredOutput("object_buckets", "json"),
      queues: requiredOutput("queues", "json"),
    },
    interfaceBlueprints: [
      {
        key: "takos.launcher",
        name: "takos.launcher",
        labels: { app: "takos" },
        spec: {
          type: "interface.ui.surface",
          version: "1",
          document: {
            launcher: true,
            display: { title: "Takos" },
          },
          inputs: {
            url: {
              source: "capsule_output",
              outputName: "launch_url",
            },
          },
          access: { visibility: "workspace" },
        },
        bindings: [
          {
            key: "takos.launcher.installer",
            subject: { source: "installing_principal" },
            permissions: ["ui.open"],
            delivery: { type: "none" },
          },
        ],
      },
    ],
    lifecycleActions: lifecycle.lifecycleActions,
    lifecycleActionPolicy: lifecycle.lifecycleActionPolicy,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const payload = installConfigFromWorkerArtifact(manifest, options);
  const text = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.output) {
    writeFileSync(options.output, text);
    console.log(`Wrote Takosumi InstallConfig patch to ${options.output}.`);
    return;
  }

  process.stdout.write(text);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error ?? "unknown error"),
    );
    process.exit(1);
  }
}
