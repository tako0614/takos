/**
 * Shared formatter for apply results.
 */
import { bold, dim, green, red } from "@std/fmt/colors";
import type { ApplyResult } from "./types.ts";

export interface PrintApplyResultOptions {
  title?: string;
  dryRun?: boolean;
}

/**
 * Print a human-readable apply result to the console.
 */
export function printApplyResult(
  result: ApplyResult,
  env: string,
  groupName: string,
  options: PrintApplyResultOptions = {},
): void {
  const titlePrefix = options.dryRun ? "[DRY RUN] " : "";
  const title = options.title || "Apply";

  console.log("");
  console.log(bold(`${titlePrefix}${title}: ${groupName}`));
  console.log(`  Environment: ${env}`);
  console.log("");

  if (result.applied.length > 0) {
    console.log(bold("Applied:"));
    for (const entry of result.applied) {
      const icon = entry.status === "success" ? green("+") : red("!");
      const errorInfo = entry.error ? red(` -- ${entry.error}`) : "";
      console.log(
        `  ${icon} ${entry.name} [${entry.category}] ${entry.action}${errorInfo}`,
      );
    }
    console.log("");
  }

  if (result.skipped.length > 0) {
    console.log(bold("Unchanged:"));
    for (const name of result.skipped) {
      console.log(`  ${dim("=")} ${name}`);
    }
    console.log("");
  }

  const succeeded = result.applied.filter((e) => e.status === "success").length;
  const failed = result.applied.filter((e) => e.status === "failed").length;

  console.log(bold("Summary:"));
  console.log(`  Applied:   ${succeeded} succeeded, ${failed} failed`);
  console.log(`  Unchanged: ${result.skipped.length}`);

  if (failed > 0) {
    console.log("");
    console.log(red("Some steps failed. Review errors above."));
  } else if (!options.dryRun) {
    console.log("");
    console.log(green("Apply completed successfully."));
  }
}
