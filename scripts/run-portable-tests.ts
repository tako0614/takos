#!/usr/bin/env -S bun
import { resolve } from "node:path";

import {
  buildPortableTestInventory,
  discoverChangedInputs,
  formatPortableTestInventory,
  loadPortableTestExclusions,
  requiresCompletePortableTests,
  validatePortableTestExclusions,
} from "./portable-test-inventory.ts";

const repoRoot = resolve(import.meta.dir, "..");

function fail(message: string): never {
  console.error(`Portable test inventory failed: ${message}`);
  process.exit(1);
}

const requested = process.argv.slice(2);
const listOnly = requested.includes("--list");
const changedIndex = requested.indexOf("--changed");
const changedRef =
  changedIndex >= 0 && requested[changedIndex + 1]
    ? requested[changedIndex + 1]
    : undefined;

const manifest = loadPortableTestExclusions(repoRoot);
const errors = validatePortableTestExclusions(manifest, repoRoot);
if (errors.length > 0) fail(errors.join("; "));

const inventory = buildPortableTestInventory(repoRoot, manifest);
if (inventory.duplicates.length > 0 || inventory.missing.length > 0) {
  fail(formatPortableTestInventory(inventory));
}
if (inventory.selected.length === 0) {
  fail("the portable test selection is empty");
}

if (listOnly) {
  console.log(formatPortableTestInventory(inventory));
  process.exit(0);
}

function changedInputs(ref?: string): string[] {
  try {
    return discoverChangedInputs(repoRoot, ref);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function runTests(paths: readonly string[], changed?: boolean): number {
  const bunArgs = ["test", "--timeout=30000"];
  if (changed) bunArgs.push(changedRef ? `--changed=${changedRef}` : "--changed");
  bunArgs.push(...paths);
  const result = Bun.spawnSync({
    cmd: ["bun", ...bunArgs],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = result.stdout.toString();
  process.stdout.write(stdout);
  return result.exitCode;
}

if (changedIndex >= 0) {
  const inputs = changedInputs(changedRef);
  if (requiresCompletePortableTests(inputs)) {
    console.error(
      "--changed: global dependency/config/inventory input changed; running the complete portable inventory",
    );
    process.exit(runTests(inventory.selected));
  }
}

const bunArgs = ["test", "--timeout=30000"];
if (changedIndex >= 0) {
  bunArgs.push(changedRef ? `--changed=${changedRef}` : "--changed");
}
bunArgs.push(...inventory.selected);

const result = Bun.spawnSync({
  cmd: ["bun", ...bunArgs],
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "inherit",
});
const stdout = result.stdout.toString();
process.stdout.write(stdout);
if (changedIndex >= 0 && result.exitCode === 0) {
  const changedSummary = /--changed:\s+\d+ changed files, running (\d+)\/\d+ test files/u.exec(
    stdout,
  );
  if (!changedSummary || Number(changedSummary[1]) === 0) {
    console.error(
      "--changed selected no test files; running the complete portable inventory",
    );
    process.exit(runTests(inventory.selected));
  }
}
process.exit(result.exitCode);
