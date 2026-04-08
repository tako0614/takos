import process from "node:process";
import type { Command } from "commander";
import { blue, bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { api } from "../lib/api.ts";
import {
  type ApplyExecutionResult,
  exitIfApplyExecutionFailed,
  printApplyExecutionResult,
} from "../lib/apply/cli-output.ts";
import {
  confirmPrompt,
  printJson,
  resolveGroupProviderOption,
  resolveSpaceId,
} from "../lib/cli-utils.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";
import {
  type AppManifest,
  loadAppManifest,
  resolveAppManifestPath,
} from "../lib/app-manifest.ts";
import {
  collectArtifactsForManifest,
  resolveWorkspaceDir,
} from "../lib/artifact-collector.ts";
import type { DiffResult } from "../lib/apply/types.ts";
import type { TranslationReport } from "../lib/translation-report.ts";

type AppDeploymentRecord = {
  id: string;
  group: { id: string; name: string };
  source: Record<string, unknown>;
  status: string;
  manifest_version: string | null;
  hostnames: string[];
  rollback_of_app_deployment_id: string | null;
  created_at: string;
  updated_at: string;
};

type AppDeploymentMutationResponse = {
  app_deployment: AppDeploymentRecord;
  apply_result: ApplyExecutionResult;
};

type AppDeploymentListResponse = {
  app_deployments: AppDeploymentRecord[];
};

type AppDeploymentGetResponse = {
  app_deployment: AppDeploymentRecord;
};

type GroupRollbackResponse = {
  group: { id: string; name: string };
  app_deployment: AppDeploymentRecord;
  apply_result: ApplyExecutionResult;
};

type DeployPlanResponse = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

type DeployCommandOptions = {
  space?: string;
  ref?: string;
  refType?: "branch" | "tag" | "commit";
  group?: string;
  env?: string;
  manifest?: string;
  provider?: string;
  plan?: boolean;
  autoApprove?: boolean;
  target?: string[];
  json?: boolean;
};

function printDeploymentSummary(
  deployment: AppDeploymentRecord,
  options: { label?: string } = {},
): void {
  const label = options.label || "Deployment";
  console.log("");
  console.log(bold(`${label}:`));
  console.log(`  ID:        ${deployment.id}`);
  console.log(`  Group:     ${deployment.group.name}`);
  console.log(`  Status:    ${deployment.status}`);
  console.log(`  Version:   ${deployment.manifest_version || "-"}`);
  console.log(`  Created:   ${deployment.created_at}`);
  if (deployment.hostnames.length > 0) {
    console.log(`  Hostnames: ${deployment.hostnames.join(", ")}`);
  }
  if (deployment.rollback_of_app_deployment_id) {
    console.log(
      `  Rollback:  from ${deployment.rollback_of_app_deployment_id}`,
    );
  }
}

async function loadLocalManifest(
  manifestOption: string | undefined,
): Promise<{ manifest: AppManifest; manifestPath: string }> {
  let manifestPath: string;
  if (manifestOption && manifestOption !== ".takos/app.yml") {
    manifestPath = manifestOption;
  } else {
    try {
      manifestPath = await resolveAppManifestPath(process.cwd());
    } catch {
      console.log(
        red(
          "No .takos/app.yml found. Specify --manifest or run from a project root.",
        ),
      );
      cliExit(1);
    }
  }

  let manifest: AppManifest;
  try {
    manifest = await loadAppManifest(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(red(`Invalid manifest: ${message}`));
    cliExit(1);
  }

  return { manifest, manifestPath };
}

async function runDeploy(
  repositoryUrl: string | undefined,
  options: DeployCommandOptions,
): Promise<void> {
  const provider = resolveGroupProviderOption(options.provider);
  const spaceId = resolveSpaceId(options.space);
  const env = options.env || "staging";
  const targets = options.target ?? [];

  const usingRepositoryUrl = Boolean(repositoryUrl?.trim());
  let source: Record<string, unknown>;
  let groupName: string | undefined = options.group;
  let manifest: AppManifest | undefined;
  let manifestPath: string | undefined;

  if (usingRepositoryUrl) {
    source = {
      kind: "git_ref",
      repository_url: repositoryUrl!.trim(),
      ...(options.ref ? { ref: options.ref } : {}),
      ...(options.refType ? { ref_type: options.refType } : {}),
    };
  } else {
    const loaded = await loadLocalManifest(options.manifest);
    manifest = loaded.manifest;
    manifestPath = loaded.manifestPath;
    if (!groupName) {
      groupName = manifest.name;
    }

    // Walk manifest.compute for entries with `build.fromWorkflow` and
    // pack the local build outputs (file by file, base64) so the
    // deploy request body carries the artifacts the backend would
    // otherwise have to fetch from a workflow run.
    const workspaceDir = resolveWorkspaceDir(manifestPath);
    const collected = collectArtifactsForManifest(manifest, {
      workspaceDir,
    });
    for (const warning of collected.warnings) {
      console.log(yellow(`Warning: ${warning}`));
    }
    if (collected.warnings.length > 0 && collected.artifacts.length === 0) {
      console.log(
        yellow(
          "No local artifacts collected. Run your build first if a worker bundle is required.",
        ),
      );
    }

    source = {
      kind: "manifest",
      manifest,
      artifacts: collected.artifacts,
    };
  }

  const baseBody: Record<string, unknown> = {
    env,
    source,
    ...(groupName ? { group_name: groupName } : {}),
    ...(provider ? { provider } : {}),
    ...(targets.length > 0 ? { target: targets } : {}),
  };

  // ── Plan / dry-run ────────────────────────────────────────────────
  if (options.plan) {
    const planResponse = await api<DeployPlanResponse>(
      `/api/spaces/${spaceId}/groups/plan`,
      {
        method: "POST",
        body: baseBody,
        timeout: 120_000,
      },
    );

    if (!planResponse.ok) {
      console.log(red(`Error: ${planResponse.error}`));
      cliExit(1);
    }

    if (options.json) {
      printJson(planResponse.data);
      return;
    }

    console.log("");
    console.log(blue(bold(`Plan: ${planResponse.data.group.name}`)));
    console.log(`  Environment: ${env}`);
    if (manifestPath) {
      console.log(`  Manifest:    ${manifestPath}`);
    }
    if (usingRepositoryUrl) {
      console.log(`  Source:      ${repositoryUrl}`);
    }
    console.log(
      `  Exists:      ${
        planResponse.data.group.exists ? "yes" : "no (preview)"
      }`,
    );
    if (targets.length > 0) {
      console.log(`  Targets:     ${targets.join(", ")}`);
    }
    console.log("");

    const totalChanges = planResponse.data.diff.entries.filter((entry) =>
      entry.action !== "unchanged"
    ).length;
    if (totalChanges === 0) {
      console.log(green("No changes. Infrastructure is up-to-date."));
    } else {
      console.log(yellow(`Plan: ${totalChanges} change(s) detected.`));
      console.log(dim("Re-run without --plan to apply these changes."));
    }

    if (
      planResponse.data.translationReport &&
      !planResponse.data.translationReport.supported
    ) {
      cliExit(1);
    }
    return;
  }

  // ── Confirmation prompt ───────────────────────────────────────────
  if (!options.autoApprove && !options.json) {
    const label = usingRepositoryUrl
      ? `repository ${repositoryUrl}`
      : `local manifest ${manifestPath}`;
    const promptMessage = `Deploy ${label} to ${env}?`;
    if (!(await confirmPrompt(promptMessage))) {
      console.log(dim("Deploy cancelled."));
      return;
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────
  console.log("");
  console.log(cyan("Deploying..."));
  console.log("");

  const response = await api<AppDeploymentMutationResponse>(
    `/api/spaces/${spaceId}/app-deployments`,
    {
      method: "POST",
      body: baseBody,
      timeout: 120_000,
    },
  );

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  printApplyExecutionResult(
    response.data.apply_result,
    env,
    response.data.app_deployment.group.name,
  );
  printDeploymentSummary(response.data.app_deployment);
  exitIfApplyExecutionFailed(response.data.apply_result);
}

async function runDeployStatus(
  appDeploymentId: string | undefined,
  options: { space?: string; json?: boolean },
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const path = appDeploymentId
    ? `/api/spaces/${spaceId}/app-deployments/${appDeploymentId}`
    : `/api/spaces/${spaceId}/app-deployments`;
  const response = appDeploymentId
    ? await api<AppDeploymentGetResponse>(path)
    : await api<AppDeploymentListResponse>(path);

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  if (appDeploymentId) {
    printDeploymentSummary(
      (response.data as AppDeploymentGetResponse).app_deployment,
    );
    return;
  }

  const deployments =
    (response.data as AppDeploymentListResponse).app_deployments;
  if (deployments.length === 0) {
    console.log(dim("No app deployments."));
    return;
  }

  for (const deployment of deployments) {
    printDeploymentSummary(deployment);
  }
}

async function runRollback(
  groupName: string,
  options: { space?: string; json?: boolean },
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const response = await api<GroupRollbackResponse>(
    `/api/spaces/${spaceId}/groups/by-name/${
      encodeURIComponent(groupName)
    }/rollback`,
    {
      method: "POST",
      body: {},
      timeout: 120_000,
    },
  );

  if (!response.ok) {
    console.log(red(`Error: ${response.error}`));
    cliExit(1);
  }

  if (options.json) {
    printJson(response.data);
    return;
  }

  printApplyExecutionResult(
    response.data.apply_result,
    "rollback",
    response.data.group.name,
    { title: "Rollback" },
  );
  printDeploymentSummary(response.data.app_deployment, {
    label: "Rollback deployment",
  });
  exitIfApplyExecutionFailed(response.data.apply_result);
}

export function registerDeployCommand(program: Command): void {
  const deploy = program
    .command("deploy")
    .description(
      "Deploy from a local app manifest or a remote repository URL",
    );

  deploy
    .argument(
      "[repositoryUrl]",
      "Optional canonical HTTPS git repository URL (defaults to local .takos/app.yml)",
    )
    .option("--space <id>", "Target workspace ID")
    .option("--env <env>", "Target environment", "staging")
    .option("--group <name>", "Target group name (defaults to manifest.name)")
    .option(
      "--manifest <path>",
      "Local manifest path (default: .takos/app.yml)",
    )
    .option("--ref <ref>", "Branch / tag / commit (repository URL only)")
    .option(
      "--ref-type <type>",
      "Source ref type: branch | tag | commit (repository URL only)",
    )
    .option(
      "--provider <provider>",
      "Deployment target provider (cloudflare|local|aws|gcp|k8s)",
    )
    .option("--plan", "Dry-run preview without applying")
    .option("--auto-approve", "Skip interactive confirmation prompt")
    .option(
      "--target <key...>",
      "Apply only specific resources/services (e.g. compute.web, storage.db)",
    )
    .option("--json", "Machine-readable output")
    .action(
      async (
        repositoryUrl: string | undefined,
        options: DeployCommandOptions,
      ) => {
        try {
          await runDeploy(repositoryUrl, options);
        } catch (error) {
          if (error instanceof CliCommandExit) throw error;
          console.log(
            red(
              `Deploy failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
          cliExit(1);
        }
      },
    );

  deploy
    .command("status [appDeploymentId]")
    .description("List app deployments or show one deployment")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(runDeployStatus);

  program
    .command("rollback")
    .description(
      "Roll back a group to its previous successful app deployment",
    )
    .argument("<groupName>", "Group name to rollback")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(async (
      groupName: string,
      options: { space?: string; json?: boolean },
    ) => {
      try {
        await runRollback(groupName, options);
      } catch (error) {
        if (error instanceof CliCommandExit) throw error;
        console.log(
          red(
            `Rollback failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        cliExit(1);
      }
    });
}
