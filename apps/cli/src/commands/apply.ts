/**
 * CLI command: `takos apply`
 *
 * Apply changes from app.yml to the target environment.
 *
 * Default (online): Send manifest to the API for plan + apply.
 * --offline: Compute diff locally and apply via the local coordinator.
 *
 * Usage:
 *   takos apply --env staging
 *   takos apply --env production --auto-approve
 *   takos apply --env staging --target resources.db --target workers.web
 *   takos apply --offline --env staging
 */
import type { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import {
  loadAppManifest,
  resolveAppManifestPath,
} from "../lib/app-manifest.ts";
import { cliExit } from "../lib/command-exit.ts";
import { confirmPrompt, resolveSpaceId } from "../lib/cli-utils.ts";
import { api } from "../lib/api.ts";
import { formatPlan } from "../lib/state/plan.ts";
import { DEFAULT_COMPATIBILITY_DATE } from "../lib/constants.ts";
import { printApplyResult } from "../lib/apply/result-formatter.ts";
import type { ApplyResult } from "../lib/apply/coordinator.ts";
import type { DiffEntry, DiffResult } from "../lib/state/diff.ts";
import type { TakosState } from "../lib/state/state-types.ts";
import type { AppManifest } from "../lib/app-manifest.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../lib/translation-report.ts";

type PlanByNameResponse = {
  group: { id: string; name: string };
  diff: DiffResult;
  translationReport: TranslationReport;
};

type ApplyByNameResponse = ApplyResult & {
  group?: { id: string; name: string };
  translationReport: TranslationReport;
};

type ApplyArtifactInput =
  | { kind: "worker-bundle"; bundleContent: string; deployMessage?: string }
  | {
    kind: "container-image";
    imageRef: string;
    provider?: "oci" | "ecs" | "cloud-run" | "k8s";
    deployMessage?: string;
  };

type ManifestWorker = NonNullable<AppManifest["spec"]["workers"]>[string];
type ManifestContainer = NonNullable<AppManifest["spec"]["containers"]>[string];
type ManifestService = NonNullable<AppManifest["spec"]["services"]>[string];

type ApplyCommandOptions = {
  manifest?: string;
  env: string;
  provider?: string;
  autoApprove?: boolean;
  target?: string[];
  accountId?: string;
  apiToken?: string;
  compatibilityDate?: string;
  namespace?: string;
  group?: string;
  baseDomain?: string;
  space?: string;
  offline?: boolean;
};

const VALID_GROUP_PROVIDERS = [
  "cloudflare",
  "local",
  "aws",
  "gcp",
  "k8s",
] as const;
type GroupProviderName = (typeof VALID_GROUP_PROVIDERS)[number];

function parseGroupProvider(raw?: string): GroupProviderName | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if ((VALID_GROUP_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as GroupProviderName;
  }
  throw new Error(`Invalid provider: ${raw}`);
}

async function collectApplyArtifacts(
  manifest: AppManifest,
  manifestPath: string,
  requiredTargets: Set<string>,
): Promise<Record<string, ApplyArtifactInput>> {
  const repoRoot = path.dirname(path.dirname(manifestPath));
  const artifacts: Record<string, ApplyArtifactInput> = {};

  for (
    const [name, worker] of Object.entries(
      manifest.spec.workers ?? {},
    ) as Array<[string, ManifestWorker]>
  ) {
    if (!requiredTargets.has(name)) continue;
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
      kind: "worker-bundle",
      bundleContent,
      deployMessage: `takos apply ${name}`,
    };
  }

  for (
    const [name, container] of Object.entries(
      manifest.spec.containers ?? {},
    ) as Array<[string, ManifestContainer]>
  ) {
    if (!requiredTargets.has(name)) continue;
    const imageRef = container.artifact?.kind === "image"
      ? container.artifact.imageRef
      : container.imageRef;
    const provider = container.artifact?.kind === "image"
      ? container.artifact.provider
      : container.provider;
    if (!imageRef) {
      throw new Error(
        `Container "${name}" requires imageRef or artifact.kind=image for online apply`,
      );
    }
    artifacts[name] = {
      kind: "container-image",
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
    if (!requiredTargets.has(name)) continue;
    const imageRef = service.artifact?.kind === "image"
      ? service.artifact.imageRef
      : service.imageRef;
    const provider = service.artifact?.kind === "image"
      ? service.artifact.provider
      : service.provider;
    if (!imageRef) {
      throw new Error(
        `Service "${name}" requires imageRef or artifact.kind=image for online apply`,
      );
    }
    artifacts[name] = {
      kind: "container-image",
      imageRef,
      provider: provider ?? "oci",
      deployMessage: `takos apply ${name}`,
    };
  }

  return artifacts;
}

/** Offline fallback: use the local coordinator (original logic). */
async function handleApplyOffline(
  manifest: Awaited<ReturnType<typeof loadAppManifest>>,
  manifestPath: string,
  options: ApplyCommandOptions,
): Promise<void> {
  const { readState, getStateDir } = await import("../lib/state/state-file.ts");
  const { computeDiff } = await import("../lib/state/diff.ts");
  const { applyDiff } = await import("../lib/apply/coordinator.ts");
  const { resolveAccountId, resolveApiToken } = await import(
    "../lib/cli-utils.ts"
  );

  const accountId = resolveAccountId(options.accountId);
  const apiToken = resolveApiToken(options.apiToken);

  const stateDir = getStateDir(process.cwd());
  const group = options.group || manifest.metadata.name;
  let currentState: TakosState | null = null;
  try {
    currentState = await readState(stateDir, group, { offline: true });
  } catch {
    // No state yet
  }

  const fullDiff = computeDiff(manifest, currentState);
  const targets = options.target || [];
  const diff = filterDiffByTargets(fullDiff, targets);

  console.log("");
  console.log(bold(`Apply: ${manifest.metadata.name}`));
  console.log(`  Environment: ${options.env}`);
  console.log(`  Manifest:    ${manifestPath}`);
  console.log(`  Mode:        offline`);
  if (targets.length > 0) {
    console.log(`  Targets:     ${targets.join(", ")}`);
  }
  console.log("");

  const planOutput = formatPlan(diff);
  console.log(planOutput);

  const totalChanges =
    diff.entries.filter((d) => d.action !== "unchanged").length;
  if (totalChanges === 0) {
    console.log(green("No changes. Infrastructure is up-to-date."));
    return;
  }

  console.log(yellow(`${totalChanges} change(s) to apply.`));
  console.log("");

  if (!options.autoApprove) {
    const hasDeletes = diff.entries.some((d) => d.action === "delete");
    const promptMessage = hasDeletes
      ? bold(red("This will DELETE resources. Continue?"))
      : "Do you want to apply these changes?";
    const confirmed = await confirmPrompt(promptMessage);
    if (!confirmed) {
      console.log(dim("Apply cancelled."));
      return;
    }
  }

  console.log("");
  console.log(cyan("Applying changes..."));
  console.log("");

  const groupName = options.group || manifest.metadata.name;
  const applyResult = await applyDiff(diff, manifest, {
    group,
    env: options.env,
    accountId,
    apiToken,
    groupName,
    namespace: options.namespace,
    manifestDir: path.dirname(manifestPath),
    baseDomain: options.baseDomain,
    autoApprove: options.autoApprove,
  });

  printApplyResult(applyResult, options.env, groupName);

  const hasFailures = applyResult.applied.some((e) => e.status === "failed");
  if (hasFailures) {
    cliExit(1);
  }

  /** Filter diff entries by --target values like "resources.db", "workers.web" */
  function filterDiffByTargets(
    diffResult: DiffResult,
    filterTargets: string[],
  ): DiffResult {
    if (filterTargets.length === 0) return diffResult;
    const filtered = diffResult.entries.filter((entry: DiffEntry) => {
      const categoryPlural = entry.category === "resource"
        ? "resources"
        : entry.category === "worker"
        ? "workers"
        : entry.category === "container"
        ? "containers"
        : entry.category === "route"
        ? "routes"
        : "services";
      const key = `${categoryPlural}.${entry.name}`;
      return filterTargets.some((t) =>
        key === t || key.endsWith(`.${t}`) || entry.name === t
      );
    });
    const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
    for (const entry of filtered) {
      summary[entry.action]++;
    }
    return {
      entries: filtered,
      hasChanges: summary.create > 0 || summary.update > 0 ||
        summary.delete > 0,
      summary,
    };
  }
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
    .option("--namespace <name>", "Dispatch namespace")
    .option("--group <name>", "Target group name (defaults to metadata.name)")
    .option("--space <id>", "Target workspace ID")
    .option(
      "--account-id <id>",
      "Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)",
    )
    .option(
      "--api-token <token>",
      "Cloudflare API token (or set CLOUDFLARE_API_TOKEN)",
    )
    .option(
      "--compatibility-date <date>",
      "Worker compatibility date",
      DEFAULT_COMPATIBILITY_DATE,
    )
    .option("--base-domain <domain>", "Base domain for template resolution")
    .option("--offline", "Force file-based state (skip API)")
    .action(async (options: ApplyCommandOptions) => {
      // Step 1: Load manifest
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

      // Offline mode: delegate to local coordinator
      if (options.offline) {
        return handleApplyOffline(manifest, manifestPath, options);
      }

      // Online mode: API-driven plan + apply
      const spaceId = resolveSpaceId(options.space);
      const group = options.group || manifest.metadata.name;
      const targets = options.target || [];

      // Step 2: Plan via API
      const planRes = await api<PlanByNameResponse>(
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

      if (!planRes.ok) {
        console.log(red(`Error: ${planRes.error}`));
        cliExit(1);
      }

      const diff = planRes.data.diff;
      const translationReport = planRes.data.translationReport;

      // Step 3: Display plan
      console.log("");
      console.log(bold(`Apply: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      if (targets.length > 0) {
        console.log(`  Targets:     ${targets.join(", ")}`);
      }
      console.log("");

      printTranslationReport(translationReport);

      if (!translationReport.supported) {
        cliExit(1);
      }

      const planOutput = formatPlan(diff);
      console.log(planOutput);

      if (!diff.hasChanges) {
        console.log(green("No changes. Infrastructure is up-to-date."));
        return;
      }

      const totalChanges = diff.entries.filter((d) =>
        d.action !== "unchanged"
      ).length;
      console.log(yellow(`${totalChanges} change(s) to apply.`));
      console.log("");

      // Step 4: Confirmation
      if (!options.autoApprove) {
        const hasDeletes = diff.entries.some((d) => d.action === "delete");
        const promptMessage = hasDeletes
          ? bold(red("This will DELETE resources. Continue?"))
          : "Do you want to apply these changes?";
        const confirmed = await confirmPrompt(promptMessage);
        if (!confirmed) {
          console.log(dim("Apply cancelled."));
          return;
        }
      }

      // Step 5: Apply via API
      console.log("");
      console.log(cyan("Applying changes..."));
      console.log("");

      let artifacts: Record<string, ApplyArtifactInput> = {};
      try {
        const requiredTargets = new Set(
          diff.entries
            .filter((entry) =>
              entry.action !== "delete" &&
              (
                entry.category === "worker" ||
                entry.category === "container" ||
                entry.category === "service"
              )
            )
            .map((entry) => entry.name),
        );
        artifacts = await collectApplyArtifacts(
          manifest,
          manifestPath,
          requiredTargets,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(red(message));
        cliExit(1);
      }

      const applyRes = await api<ApplyByNameResponse>(
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

      if (!applyRes.ok) {
        console.log(red(`Error: ${applyRes.error}`));
        cliExit(1);
      }

      const result = applyRes.data;
      const groupName = result.group?.name || options.group ||
        manifest.metadata.name;
      printTranslationReport(result.translationReport);
      printApplyResult(result, options.env, groupName);

      const hasFailures = result.applied.some((e) => e.status === "failed");
      if (hasFailures) {
        cliExit(1);
      }
    });
}
