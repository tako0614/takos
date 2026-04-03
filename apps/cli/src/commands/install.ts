import type { Command } from "commander";
import { bold, red } from "@std/fmt/colors";
import { api } from "../lib/api.ts";
import {
  exitIfApplyExecutionFailed,
  printApplyExecutionResult,
} from "../lib/apply/cli-output.ts";
import {
  printJson,
  resolveGroupProviderOption,
  resolveSpaceId,
} from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import type { DiffResult } from "../lib/state/diff.ts";
import type { TranslationReport } from "../lib/translation-report.ts";

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

type LatestPackageResponse = {
  package: {
    version: string;
    repository_url: string;
    release: {
      tag: string;
    };
  };
};

type PackageVersionsResponse = {
  versions: Array<{
    tag: string;
    version: string;
    repository_url: string;
  }>;
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
  const [owner, repoName, ...rest] = input.split("/").map((value) =>
    value.trim()
  );
  if (!owner || !repoName || rest.length > 0) {
    throw new Error("Package must be in OWNER/REPO format");
  }
  return { owner, repoName };
}

async function resolvePackageDeploySource(
  owner: string,
  repoName: string,
  requestedVersion?: string,
): Promise<{ repositoryUrl: string; tag: string; version: string }> {
  if (!requestedVersion) {
    const latest = await api<LatestPackageResponse>(
      `/api/explore/packages/${encodeURIComponent(owner)}/${
        encodeURIComponent(repoName)
      }/latest`,
    );
    if (!latest.ok) {
      throw new Error(latest.error);
    }
    return {
      repositoryUrl: latest.data.package.repository_url,
      tag: latest.data.package.release.tag,
      version: latest.data.package.version,
    };
  }

  const versions = await api<PackageVersionsResponse>(
    `/api/explore/packages/${encodeURIComponent(owner)}/${
      encodeURIComponent(repoName)
    }/versions`,
  );
  if (!versions.ok) {
    throw new Error(versions.error);
  }
  const match = versions.data.versions.find((entry) =>
    entry.version === requestedVersion || entry.tag === requestedVersion
  );
  if (!match) {
    throw new Error(`Package version not found: ${requestedVersion}`);
  }
  return {
    repositoryUrl: match.repository_url,
    tag: match.tag,
    version: match.version,
  };
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

      try {
        ownerRepo = parseOwnerRepo(packageRef);
      } catch (error) {
        console.log(
          red(error instanceof Error ? error.message : String(error)),
        );
        cliExit(1);
      }

      const provider = resolveGroupProviderOption(options.provider);

      let resolvedSource: {
        repositoryUrl: string;
        tag: string;
        version: string;
      };
      try {
        resolvedSource = await resolvePackageDeploySource(
          ownerRepo.owner,
          ownerRepo.repoName,
          options.version,
        );
      } catch (error) {
        console.log(
          red(error instanceof Error ? error.message : String(error)),
        );
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
              kind: "git_ref",
              repository_url: resolvedSource.repositoryUrl,
              ref: resolvedSource.tag,
              ref_type: "tag",
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

      printApplyExecutionResult(
        response.data.apply_result,
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
        `  Version:   ${
          resolvedSource.version ||
          response.data.app_deployment.manifest_version || "-"
        }`,
      );
      if (response.data.app_deployment.hostnames.length > 0) {
        console.log(
          `  Hostnames: ${response.data.app_deployment.hostnames.join(", ")}`,
        );
      }

      exitIfApplyExecutionFailed(response.data.apply_result);
    });
}
