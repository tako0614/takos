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

const root = resolve(import.meta.dir, "..");
const ledgerPath = "quality/typescript-debt.json";

const projects = ["tsconfig.check.json", "web/tsconfig.json"] as const;
const diagnostics: Diagnostic[] = [];

for (const project of projects) {
  const compiled = Bun.spawn(
    ["bunx", "tsc", "--noEmit", "-p", project, "--pretty", "false"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(compiled.stdout).text(),
    new Response(compiled.stderr).text(),
  ]);
  await compiled.exited;
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  const reported = lines.filter((line) => line.includes("error TS"));
  const withoutFile = reported.filter((line) => !/^\S+\(\d+,\d+\): /.test(line));
  if (withoutFile.length > 0) {
    console.error(`${project}: TypeScript reported a project-level failure:`);
    for (const line of withoutFile) console.error(`- ${line}`);
    process.exit(1);
  }
  for (const line of reported) {
    const file = line.slice(0, line.indexOf("("));
    diagnostics.push({ file, text: line });
  }
}

const ledger = await readDebtLedger(resolve(root, ledgerPath));
process.exit(
  reportLedger("Project-wide type check", ledger, diagnostics, ledgerPath),
);
