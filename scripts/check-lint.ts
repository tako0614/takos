#!/usr/bin/env bun

/**
 * Static analysis gate.
 *
 * Takos had no linter, so the `lint-or-static-analysis` obligation the
 * ecosystem gate contract names was unmet. This runs oxlint over every
 * TypeScript source tree and refuses any finding — error or warning — that is
 * not counted in `quality/lint-debt.json`, on the same countdown rules as the
 * type ledger.
 */

import { resolve } from "node:path";

import {
  type Diagnostic,
  readDebtLedger,
  reportLedger,
} from "./quality-ledger.ts";
import { qualityProcessFailure } from "./quality-process-result.ts";

const root = resolve(import.meta.dir, "..");
const ledgerPath = "quality/lint-debt.json";
const roots = ["src", "web/src", "scripts", "website/src"];

const linted = Bun.spawn(
  ["bunx", "oxlint", ...roots, "--format=json", "--deny-warnings"],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
const [stdout, stderr] = await Promise.all([
  new Response(linted.stdout).text(),
  new Response(linted.stderr).text(),
]);
const exitCode = await linted.exited;

let report: { diagnostics: Array<Record<string, unknown>> };
let parsed: unknown;
try {
  parsed = JSON.parse(stdout);
} catch {
  console.error("oxlint did not produce a JSON report:");
  console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
  process.exit(1);
}

if (
  typeof parsed !== "object" || parsed === null ||
  !Array.isArray((parsed as { diagnostics?: unknown }).diagnostics)
) {
  console.error("oxlint produced a malformed JSON report:");
  console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
  process.exit(1);
}
report = parsed as typeof report;

if (
  report.diagnostics.some((entry) =>
    typeof entry !== "object" || entry === null ||
    typeof entry.filename !== "string" || typeof entry.code !== "string" ||
    typeof entry.message !== "string" ||
    (entry.labels !== undefined && !Array.isArray(entry.labels))
  )
) {
  console.error("oxlint produced a malformed JSON report:");
  console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
  process.exit(1);
}

if (
  report.diagnostics.some((entry) => {
    if (entry.labels === undefined) return false;
    return (entry.labels as unknown[]).some((label) => {
      if (typeof label !== "object" || label === null) return true;
      const span = (label as { span?: unknown }).span;
      if (typeof span !== "object" || span === null) return true;
      const { line, column } = span as { line?: unknown; column?: unknown };
      return !Number.isInteger(line) || Number(line) < 1 ||
        !Number.isInteger(column) || Number(column) < 1;
    });
  })
) {
  console.error("oxlint produced malformed diagnostic locations:");
  console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
  process.exit(1);
}

const processFailure = qualityProcessFailure(
  "oxlint",
  exitCode,
  linted.signalCode,
  report.diagnostics.length,
  1,
  stdout,
  stderr,
);
if (processFailure) {
  console.error(processFailure);
  process.exit(1);
}

const diagnostics: Diagnostic[] = report.diagnostics.map((entry) => {
  const file = typeof entry.filename === "string" ? entry.filename : "<unknown>";
  const label = Array.isArray(entry.labels) && entry.labels.length > 0
    ? entry.labels[0] as { span?: { line?: number; column?: number } }
    : undefined;
  const line = label?.span?.line ?? 0;
  const column = label?.span?.column ?? 0;
  const code = typeof entry.code === "string" ? entry.code : "oxlint";
  const message = typeof entry.message === "string" ? entry.message : "";
  return { file, text: `${file}(${line},${column}): ${code}: ${message}` };
});

const ledger = await readDebtLedger(resolve(root, ledgerPath));
process.exit(reportLedger("Lint", ledger, diagnostics, ledgerPath));
