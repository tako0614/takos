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
await linted.exited;

let report: { diagnostics?: Array<Record<string, unknown>> };
try {
  report = JSON.parse(stdout) as typeof report;
} catch {
  console.error("oxlint did not produce a JSON report:");
  console.error(stderr || stdout);
  process.exit(1);
}

const diagnostics: Diagnostic[] = (report.diagnostics ?? []).map((entry) => {
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
