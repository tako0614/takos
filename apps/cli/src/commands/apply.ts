import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import {
  loadAppManifest,
  resolveAppManifestPath,
  type AppManifest,
} from "../lib/app-manifest.ts";
import { api } from "../lib/api.ts";
import { printApplyResult } from "../lib/apply/result-formatter.ts";
import { confirmPrompt, resolveSpaceId } from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import {
  type GroupProviderName,
  parseGroupProvider,
} from "../lib/group-provider.ts";
import type { DiffEntry, DiffResult } from "../lib/state/diff.ts";
import { formatPlan } from "../lib/state/plan.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";

type PrintableApplyResult = Parameters<typeof printApplyResult>[0];

type ApplyArtifactInput =
  | { kind: "worker_bundle"; bundleContent: string; deployMessage?: string }
  | {
    kind: "container_image";
    imageRef: string;
    provider?: "oci" | "ecs" | "cloud-run" | "k8s";
    deployMessage?: string;
  };

type ApplyByNameResponse = {
  group?: { id: string; name: string };
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
  appToken?: {
    issued: true;
    scopes: string[];
    expiresIn: number;
  };
};

type PlanByNameResponse = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

type ApplyCommandOptions = {
  manifest?: string;
  env: string;
  provider?: string;
  autoApprove?: boolean;
  target?: string[];
  group?: string;
  space?: string;
};

type ManifestWorker = NonNullable<AppManifest["spec"]["workers"]>[string];
type ManifestContainer = NonNullable<AppManifest["spec"]["containers"]>[string];
type ManifestService = NonNullable<AppManifest["spec"]["services"]>[string];

function targetIncludes(
  targets: string[],
  prefixes: string[],
  name: string,
): boolean {
  if (targets.length === 0) return true;
  return targets.some((target) => {
    if (target === name) return true;
    return prefixes.some((prefix) => target === `${prefix}.${name}`);
  });
}

async function collectApplyArtifacts(
  manifest: AppManifest,
  manifestPath: string,
  targets: string[],
): Promise<Record<string, ApplyArtifactInput>> {
  const repoRoot = path.dirname(path.dirname(manifestPath));
  const artifacts: Record<string, ApplyArtifactInput> = {};

  for (
    const [name, worker] of Object.entries(
      manifest.spec.workers ?? {},
    ) as Array<[string, ManifestWorker]>
  ) {
    if (!targetIncludes(targets, ["workers"], name)) continue;
    if (!worker.build?.fromWorkflow) continue;

    const artifactPath = path.resolve(
      repoRoot,
      worker.build.fromWorkflow.artifactPath,
    );
    const bundleContent = await fs.readFile(artifactPath, "utf8").catch(
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to read worker artifact for "${name}": ${message}`,
        );
      },
    );
    artifacts[name] = {
      kind: "worker_bundle",
      bundleContent,
      deployMessage: `takos apply ${name}`,
    };
  }

  for (
    const [name, container] of Object.entries(
      manifest.spec.containers ?? {},
    ) as Array<[string, ManifestContainer]>
  ) {
    if (!targetIncludes(targets, ["containers"], name)) continue;
    const imageRef = container.artifact?.kind === "image"
      ? container.artifact.imageRef
      : container.imageRef;
    const provider = container.artifact?.kind === "image"
      ? container.artifact.provider
      : container.provider;
    if (!imageRef) continue;
    artifacts[name] = {
      kind: "container_image",
      imageRef,
      provider: provider ?? "oci",
      deployMessage: `takos apply ${name}`,
    };
  }

  for (
    const [name, service] of Object.entries(
      manifest.spec.services ?? {},
    ) as Array<[string, ManifestService]>
  ) {
    if (!targetIncludes(targets, ["services"], name)) continue;
    const imageRef = service.artifact?.kind === "image"
      ? service.artifact.imageRef
      : service.imageRef;
    const provider = service.artifact?.kind === "image"
      ? service.artifact.provider
      : service.provider;
    if (!imageRef) continue;
    artifacts[name] = {
      kind: "container_image",
      imageRef,
      provider: provider ?? "oci",
      deployMessage: `takos apply ${name}`,
    };
  }

  return artifacts;
}

export function registerApplyCommand(program: Command): void {
  program
    .command("apply")
    .description("Apply changes from app.yml to the target environment")
    .option("--manifest <path>", "Path to app manifest", ".takos/app.yml")
    .option("--env <env>", "Target environment", "staging")
    .option(
      "--provider <provider>",
      "Deployment target provider (cloudflare|local|aws|gcp|k8s)",
    )
    .option("--auto-approve", "Skip interactive confirmation prompt")
    .option(
      "--target <key...>",
      "Apply only specific resources/services (e.g. resources.db, workers.web)",
    )
    .option("--group <name>", "Target group name (defaults to metadata.name)")
    .option("--space <id>", "Target workspace ID")
    .action(async (options: ApplyCommandOptions) => {
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
      const spaceId = resolveSpaceId(options.space);
      const targets = options.target || [];

      const planResponse = await api<PlanByNameResponse>(
        `/api/spaces/${spaceId}/groups/plan`,
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

      if (!planResponse.ok) {
        console.log(red(`Error: ${planResponse.error}`));
        cliExit(1);
      }

      console.log("");
      console.log(bold(`Apply: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      console.log(`  Group:       ${planResponse.data.group.name}`);
      if (targets.length > 0) {
        console.log(`  Targets:     ${targets.join(", ")}`);
      }
      console.log("");

      printTranslationReport(planResponse.data.translationReport);
      console.log(formatPlan(planResponse.data.diff));

      if (!planResponse.data.translationReport.supported) {
        cliExit(1);
      }

      if (!planResponse.data.diff.hasChanges) {
        console.log(green("No changes. Infrastructure is up-to-date."));
        return;
      }

      const totalChanges = planResponse.data.diff.entries.filter((entry) =>
        entry.action !== "unchanged"
      ).length;
      console.log(yellow(`${totalChanges} change(s) to apply.`));
      console.log("");

      if (!options.autoApprove) {
        const hasDeletes = planResponse.data.diff.entries.some((entry) =>
          entry.action === "delete"
        );
        const promptMessage = hasDeletes
          ? bold(red("This will DELETE resources. Continue?"))
          : "Do you want to apply these changes?";
        if (!(await confirmPrompt(promptMessage))) {
          console.log(dim("Apply cancelled."));
          return;
        }
      }

      let artifacts: Record<string, ApplyArtifactInput> = {};
      try {
        artifacts = await collectApplyArtifacts(manifest, manifestPath, targets);
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
        cliExit(1);
      }

      console.log("");
      console.log(cyan("Applying changes..."));
      console.log("");

      const applyResponse = await api<ApplyByNameResponse>(
        `/api/spaces/${spaceId}/groups/apply`,
        {
          method: "POST",
          body: {
            group_name: group,
            env: options.env,
            ...(provider ? { provider } : {}),
            manifest,
            artifacts,
            target: targets.length > 0 ? targets : undefined,
          },
          timeout: 120_000,
        },
      );

      if (!applyResponse.ok) {
        console.log(red(`Error: ${applyResponse.error}`));
        cliExit(1);
      }

      printTranslationReport(applyResponse.data.translationReport);
      const printableResult: PrintableApplyResult = {
        applied: applyResponse.data.applied,
        skipped: applyResponse.data.skipped,
      };
      printApplyResult(
        printableResult,
        options.env,
        applyResponse.data.group?.name || group,
      );

      const hasFailures = applyResponse.data.applied.some((entry) =>
        entry.status === "failed"
      );
      if (hasFailures) {
        cliExit(1);
      }
    });
}
