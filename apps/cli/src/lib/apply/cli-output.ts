import type { ApplyEntryResult, DiffResult } from "./types.ts";
import {
  printTranslationReport,
  type TranslationReport,
} from "../translation-report.ts";
import { cliExit } from "../command-exit.ts";
import { printApplyResult } from "./result-formatter.ts";

type PrintableApplyResult = Parameters<typeof printApplyResult>[0];

export type ApplyExecutionEntry = ApplyEntryResult;

export type ApplyExecutionResult = {
  applied: ApplyExecutionEntry[];
  skipped: string[];
  diff: DiffResult;
  translationReport: TranslationReport;
};

export function printApplyExecutionResult(
  result: ApplyExecutionResult,
  envLabel: string,
  groupName: string,
  options?: { title?: string },
): void {
  printTranslationReport(result.translationReport);
  const printableResult: PrintableApplyResult = {
    applied: result.applied,
    skipped: result.skipped,
  };
  printApplyResult(printableResult, envLabel, groupName, options);
}

export function hasApplyExecutionFailures(
  result: Pick<ApplyExecutionResult, "applied">,
): boolean {
  return result.applied.some((entry) => entry.status === "failed");
}

export function exitIfApplyExecutionFailed(
  result: Pick<ApplyExecutionResult, "applied">,
): void {
  if (hasApplyExecutionFailures(result)) {
    cliExit(1);
  }
}
