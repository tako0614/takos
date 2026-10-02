#!/usr/bin/env bun

/**
 * Project-wide TypeScript gate.
 *
 * Takos has two TypeScript programs — the Worker/scripts program
 * (`tsconfig.check.json`) and the Solid web client (`web/tsconfig.json`) — and
 * this gate compiles both in full. Nothing is filtered by diagnostic code and
 * no directory is excluded: a file either type-checks or its remaining
 * diagnostics are written down in `quality/typescript-debt.json`, which is a
 * countdown rather than an allowlist.
 *
 * The gate this replaced compiled 19 of 817 non-test files and then discarded
 * every web diagnostic except TS2304/TS2552, which is how modules that no
 * longer exist stayed imported.
 */

import { resolve } from "node:path";

import {
  type Diagnostic,
  readDebtLedger,
  reportLedger,
} from "./quality-ledger.ts";
import { qualityProcessFailure } from "./quality-process-result.ts";

const root = resolve(import.meta.dir, "..");
const ledgerPath = "quality/typescript-debt.json";

const projects = ["tsconfig.check.json", "web/tsconfig.json"] as const;
const diagnostics: Diagnostic[] = [];

function parseCompilerOutput(stdout: string): {
  diagnostics: Diagnostic[];
  projectFailures: string[];
  unrecognized: string[];
} {
  const diagnostics: Diagnostic[] = [];
  const projectFailures: string[] = [];
  const unrecognized: string[] = [];
  let hasDiagnosticHeader = false;

  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const diagnosticHeader = /^(.+)\((\d+),(\d+)\): error TS\d+: /.exec(line);
    if (diagnosticHeader) {
      diagnostics.push({ file: diagnosticHeader[1]!, text: line });
      hasDiagnosticHeader = true;
      continue;
    }
    if (/^error TS\d+: /.test(line)) {
      projectFailures.push(line);
      hasDiagnosticHeader = false;
      continue;
    }

    const continuationIndent = /^( +)\S/.exec(line)?.[1]?.length ?? 0;
    if (
      hasDiagnosticHeader && continuationIndent >= 2 &&
      continuationIndent % 2 === 0
    ) {
      continue;
    }
    unrecognized.push(line);
    hasDiagnosticHeader = false;
  }

  return { diagnostics, projectFailures, unrecognized };
}

for (const project of projects) {
  const compiled = Bun.spawn(
    ["bunx", "tsc", "--noEmit", "-p", project, "--pretty", "false"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(compiled.stdout).text(),
    new Response(compiled.stderr).text(),
  ]);
  const exitCode = await compiled.exited;
  const parsed = parseCompilerOutput(stdout);
  const processFailure = qualityProcessFailure(
    `${project}: TypeScript`,
    exitCode,
    compiled.signalCode,
    parsed.diagnostics.length + parsed.projectFailures.length,
    2,
    stdout,
    stderr,
  );
  if (processFailure) {
    console.error(processFailure);
    process.exit(1);
  }

  if (parsed.unrecognized.length > 0) {
    console.error(`${project}: TypeScript emitted unrecognized output:`);
    for (const line of parsed.unrecognized) console.error(`- ${line}`);
    console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
    process.exit(1);
  }
  if (parsed.projectFailures.length > 0) {
    console.error(`${project}: TypeScript reported a project-level failure:`);
    for (const line of parsed.projectFailures) console.error(`- ${line}`);
    console.error(`stdout:\n${stdout}\nstderr:\n${stderr}`);
    process.exit(1);
  }
  diagnostics.push(...parsed.diagnostics);
}

const ledger = await readDebtLedger(resolve(root, ledgerPath));
process.exit(
  reportLedger("Project-wide type check", ledger, diagnostics, ledgerPath),
);
