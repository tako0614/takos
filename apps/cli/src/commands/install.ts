import { Command } from "commander";
import { bold, red } from "@std/fmt/colors";
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

type AppDeploymentMutationResponse = {
  app_deployment: {
    id: string;
    group: { id: string; name: string };
    status: string;
    manifest_version: string | null;
    hostnames: string[];
    created_at: string;
  };
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

type InstallCommandOptions = {
  version?: string;
  group?: string;
  env?: string;
  provider?: string;
  space?: string;
  json?: boolean;
};

function parseOwnerRepo(input: string): { owner: string; repoName: string } {
  const [owner, repoName, ...rest] = input.split("/").map((value) => value.trim());
  if (!owner || !repoName || rest.length > 0) {
    throw new Error("Package must be in OWNER/REPO format");
  }
  return { owner, repoName };
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install <packageRef>")
    .description("Install an app from the Takos package catalog")
    .option("--version <version>", "Release version or tag")
    .option("--group <name>", "Target group name")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--provider <provider>",
      "Deployment target provider (cloudflare|local|aws|gcp|k8s)",
    )
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(async (packageRef: string, options: InstallCommandOptions) => {
      let ownerRepo: { owner: string; repoName: string };
      let provider: GroupProviderName | undefined;

      try {
        ownerRepo = parseOwnerRepo(packageRef);
        provider = parseGroupProvider(options.provider);
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
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
              kind: "package_release",
              owner: ownerRepo.owner,
              repo_name: ownerRepo.repoName,
              ...(options.version ? { version: options.version } : {}),
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
        { title: "Install" },
      );

      console.log("");
      console.log(bold("Installed package:"));
      console.log(`  ID:        ${response.data.app_deployment.id}`);
      console.log(`  Group:     ${response.data.app_deployment.group.name}`);
      console.log(`  Status:    ${response.data.app_deployment.status}`);
      console.log(
        `  Version:   ${response.data.app_deployment.manifest_version || "-"}`,
      );
      if (response.data.app_deployment.hostnames.length > 0) {
        console.log(
          `  Hostnames: ${response.data.app_deployment.hostnames.join(", ")}`,
        );
      }

      if (
        response.data.apply_result.applied.some((entry) => entry.status === "failed")
      ) {
        cliExit(1);
      }
    });
}
