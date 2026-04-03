import type { Command } from "commander";
import { bold, red } from "@std/fmt/colors";
import { api } from "../lib/api.ts";
import {
  exitIfApplyExecutionFailed,
  printApplyExecutionResult,
} from "../lib/apply/cli-output.ts";
import { printJson, resolveSpaceId } from "../lib/cli-utils.ts";
import { cliExit } from "../lib/command-exit.ts";
import type { DiffResult } from "../lib/state/diff.ts";
import type { TranslationReport } from "../lib/translation-report.ts";

type UninstallResponse = {
  group: { id: string; name: string };
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
  uninstalled: boolean;
  deleted_group: boolean;
};

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall <groupName>")
    .description(
      "Uninstall a deployed app group and remove its managed resources",
    )
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable output")
    .action(async (
      groupName: string,
      options: { space?: string; json?: boolean },
    ) => {
      const response = await api<UninstallResponse>(
        `/api/spaces/${resolveSpaceId(options.space)}/groups/uninstall`,
        {
          method: "POST",
          body: {
            group_name: groupName,
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
        "uninstall",
        response.data.group.name,
        {
          title: "Uninstall",
        },
      );

      console.log("");
      console.log(bold("Uninstalled group:"));
      console.log(`  ID:      ${response.data.group.id}`);
      console.log(`  Name:    ${response.data.group.name}`);
      console.log(`  Deleted: ${response.data.deleted_group ? "yes" : "no"}`);

      exitIfApplyExecutionFailed(response.data.apply_result);
    });
}
