import { Command } from "commander";
import { bold, dim, green, red } from "@std/fmt/colors";
import { api } from "../lib/api.ts";
import { printApplyResult } from "../lib/apply/result-formatter.ts";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import {
  type GroupProviderName,
  parseGroupProvider,
} from "../lib/group-provider.ts";
import type { DiffResult } from "../lib/state/diff.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";

type PrintableApplyResult = Parameters<typeof printApplyResult>[0];

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
  apply_result: {
    applied: Array<{
      name: string;
      category: string;
      action: string;
      status: "success" | "failed";
      error?: string;
    }>;
    skipped: string[];
    diff: DiffResult;
    translationReport: TranslationReport;
  };
};

type AppDeploymentListResponse = {
  app_deployments: AppDeploymentRecord[];
};

type AppDeploymentGetResponse = {
  app_deployment: AppDeploymentRecord;
};

type DeployCommandOptions = {
  space?: string;
  repo?: string;
  ref?: string;
  refType?: "branch" | "tag" | "commit";
  group?: string;
  env?: string;
  provider?: string;
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

async function runCreateDeployment(
  options: DeployCommandOptions,
): Promise<void> {
  if (!options.repo?.trim()) {
    console.log(red("--repo is required."));
    cliExit(1);
  }

  let provider: GroupProviderName | undefined;
  try {
    provider = parseGroupProvider(options.provider);
  } catch (error) {
    console.log(red(error instanceof Error ? error.message : "Invalid provider"));
    cliExit(1);
  }

  const response = await api<AppDeploymentMutationResponse>(
    `/api/spaces/${resolveSpaceId(options.space)}/app-deployments`,
    {
      method: "POST",
      body: {
        group_name: options.group,
        env: options.env || "staging",
        ...(provider ? { provider } : {}),
        source: {
          kind: "repo_ref",
          repo_id: options.repo.trim(),
          ...(options.ref ? { ref: options.ref } : {}),
          ...(options.refType ? { ref_type: options.refType } : {}),
        },
      },
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

  printTranslationReport(response.data.apply_result.translationReport);
  const printableResult: PrintableApplyResult = {
    applied: response.data.apply_result.applied,
    skipped: response.data.apply_result.skipped,
  };
  printApplyResult(
    printableResult,
    options.env || "staging",
    response.data.app_deployment.group.name,
  );
  printDeploymentSummary(response.data.app_deployment);

  if (
    response.data.apply_result.applied.some((entry) => entry.status === "failed")
  ) {
    cliExit(1);
  }
}

export function registerDeployCommand(program: Command): void {
  const deploy = program
    .command("deploy")
    .description("Deploy an app from a repository ref");

  deploy
    .option("--space <id>", "Target workspace ID")
    .requiredOption("--repo <id>", "Repository ID")
    .option("--ref <ref>", "Branch, tag, or commit ref")
    .option("--ref-type <type>", "Source ref type (branch|tag|commit)")
    .option("--group <name>", "Target group name")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--provider <provider>",
      "Deployment target provider (cloudflare|local|aws|gcp|k8s)",
    )
    .option("--json", "Machine-readable output")
    .action(runCreateDeployment);

  deploy
    .command("status [appDeploymentId]")
    .description("List app deployments or show one deployment")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(async (
      appDeploymentId: string | undefined,
      options: { space?: string; json?: boolean },
    ) => {
      const path = appDeploymentId
        ? `/api/spaces/${resolveSpaceId(options.space)}/app-deployments/${appDeploymentId}`
        : `/api/spaces/${resolveSpaceId(options.space)}/app-deployments`;
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
        printDeploymentSummary((response.data as AppDeploymentGetResponse).app_deployment);
        return;
      }

      const deployments = (response.data as AppDeploymentListResponse).app_deployments;
      if (deployments.length === 0) {
        console.log(dim("No app deployments."));
        return;
      }

      for (const deployment of deployments) {
        printDeploymentSummary(deployment);
      }
    });

  deploy
    .command("rollback <appDeploymentId>")
    .description("Roll back to the previous successful app deployment")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(async (
      appDeploymentId: string,
      options: { space?: string; json?: boolean },
    ) => {
      const response = await api<AppDeploymentMutationResponse>(
        `/api/spaces/${resolveSpaceId(options.space)}/app-deployments/${appDeploymentId}/rollback`,
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

      printTranslationReport(response.data.apply_result.translationReport);
      const printableResult: PrintableApplyResult = {
        applied: response.data.apply_result.applied,
        skipped: response.data.apply_result.skipped,
      };
      printApplyResult(
        printableResult,
        "rollback",
        response.data.app_deployment.group.name,
        { title: "Rollback" },
      );
      printDeploymentSummary(response.data.app_deployment, {
        label: "Rollback deployment",
      });

      if (
        response.data.apply_result.applied.some((entry) =>
          entry.status === "failed"
        )
      ) {
        cliExit(1);
      }
    });
}
