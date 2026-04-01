import type { Command } from "commander";
import { bold, dim, green, red, yellow } from "@std/fmt/colors";
import {
  loadAppManifest,
  resolveAppManifestPath,
} from "../lib/app-manifest.ts";
import { api } from "../lib/api.ts";
import { resolveSpaceId } from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import {
  type GroupProviderName,
  parseGroupProvider,
} from "../lib/group-provider.ts";
import { formatPlan } from "../lib/state/plan.ts";
import type { DiffResult } from "../lib/state/diff.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";

type PlanByNameResponse = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

type PlanCommandOptions = {
  manifest?: string;
  env: string;
  provider?: string;
  group?: string;
  space?: string;
};

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Show execution plan: diff between app.yml and current state")
    .option("--manifest <path>", "Path to app manifest", ".takos/app.yml")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--provider <provider>",
      "Deployment target provider (cloudflare|local|aws|gcp|k8s)",
    )
    .option("--group <name>", "Target group name (defaults to metadata.name)")
    .option("--space <id>", "Target workspace ID")
    .action(async (options: PlanCommandOptions) => {
      let manifestPath: string;
      try {
        manifestPath = options.manifest && options.manifest !== ".takos/app.yml"
          ? options.manifest
          : await resolveAppManifestPath(process.cwd());
      } catch {
        console.log(
          red(
            "No .takos/app.yml found. Specify --manifest or run from a project root.",
          ),
        );
        cliExit(1);
      }

      let manifest;
      try {
        manifest = await loadAppManifest(manifestPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(red(`Invalid manifest: ${message}`));
        cliExit(1);
      }

      let provider: GroupProviderName | undefined;
      try {
        provider = parseGroupProvider(options.provider);
      } catch (error) {
        console.log(
          red(error instanceof Error ? error.message : "Invalid provider"),
        );
        cliExit(1);
      }

      const group = options.group || manifest.metadata.name;
      const response = await api<PlanByNameResponse>(
        `/api/spaces/${resolveSpaceId(options.space)}/groups/plan`,
        {
          method: "POST",
          body: {
            group_name: group,
            env: options.env,
            ...(provider ? { provider } : {}),
            manifest,
          },
        },
      );

      if (!response.ok) {
        console.log(red(`Error: ${response.error}`));
        cliExit(1);
      }

      console.log("");
      console.log(bold(`Plan: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      console.log(`  Group:       ${response.data.group.name}`);
      console.log(
        `  Exists:      ${response.data.group.exists ? "yes" : "no (preview)"}`,
      );
      console.log("");

      printTranslationReport(response.data.translationReport);
      console.log(formatPlan(response.data.diff));

      const totalChanges = response.data.diff.entries.filter((entry) =>
        entry.action !== "unchanged"
      ).length;
      if (totalChanges === 0) {
        console.log(green("No changes. Infrastructure is up-to-date."));
      } else {
        console.log(yellow(`Plan: ${totalChanges} change(s) detected.`));
        console.log(dim("Run `takos apply` to apply these changes."));
      }

      if (!response.data.translationReport.supported) {
        cliExit(1);
      }
    });
}
