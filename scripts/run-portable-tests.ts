#!/usr/bin/env bun

/**
 * Portable and explicitly online test runner.
 *
 * Every tracked test file is classified by one of the two ledgers: the
 * portable gate runs files in neither ledger, while `--online` runs the files
 * in `quality/test-online.json`. `--verify-quarantine` keeps the existing
 * quarantine claim check separate from online evidence.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canRunTestSelection,
  selectTestFiles,
  validateTestInventory,
  type TestInventory,
} from "./test-inventory.ts";

const root = resolve(import.meta.dir, "..");
const quarantinePath = "quality/test-quarantine.json";
const onlinePath = "quality/test-online.json";
const supportedFlags = new Set(["--list", "--online", "--verify-quarantine"]);

type TestMode = "portable" | "online" | "quarantine";

if (import.meta.main) await main();

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const unknown = args.filter((arg) => !supportedFlags.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown runner argument(s): ${unknown.join(", ")}`);
    process.exit(1);
  }

  const verifyQuarantine = args.includes("--verify-quarantine");
  const online = args.includes("--online");
  const list = args.includes("--list");
  if (verifyQuarantine && online) {
    console.error("--online and --verify-quarantine are mutually exclusive.");
    process.exit(1);
  }

  const quarantine = await readManifest(quarantinePath);
  const onlineManifest = await readManifest(onlinePath);
  const tracked = await trackedTestFiles();
  const validation = validateTestInventory(
    tracked,
    quarantine,
    onlineManifest,
  );
  if (validation.issues.length > 0) {
    console.error("Test inventory validation failed:");
    for (const issue of validation.issues) {
      console.error(`- ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }

  const mode: TestMode = verifyQuarantine
    ? "quarantine"
    : online
      ? "online"
      : "portable";
  const selected = selectTestFiles(validation.inventory, mode);
  if (list) {
    listSelection(mode, selected, validation.inventory);
    return;
  }
  if (!canRunTestSelection(mode, selected)) {
    console.error(`Refusing to run an empty ${mode} test selection.`);
    process.exit(1);
  }

  if (verifyQuarantine) {
    await verifyQuarantined(selected);
    return;
  }

  const label = mode === "online" ? "online" : "portable";
  if (mode === "portable") {
    console.log(
      `Running ${selected.length} ${label} test file(s); ` +
        `${validation.inventory.quarantined.length} quarantined and ` +
        `${validation.inventory.online.length} online file(s) excluded.`,
    );
  } else {
    console.log(`Running ${selected.length} ${label} test file(s).`);
  }
  const passed = await runTests(selected, "inherit");
  process.exit(passed ? 0 : 1);
}

async function readManifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(root, path), "utf8")) as unknown;
  } catch (error) {
    console.error(
      `${path}: unable to read or parse manifest: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

function listSelection(
  mode: TestMode,
  selected: readonly string[],
  inventory: TestInventory,
): void {
  const label = mode === "quarantine" ? "quarantine" : mode;
  console.log(`${label} test selection (${selected.length} file(s)):`);
  for (const file of selected) console.log(file);
  if (mode === "portable") {
    console.log(
      `${inventory.quarantined.length} quarantined; ` +
        `${inventory.online.length} online excluded.`,
    );
  }
}

async function verifyQuarantined(files: readonly string[]): Promise<void> {
  const stillFailing: string[] = [];
  const nowPassing: string[] = [];
  for (const file of files) {
    const passed = await runTests([file], "ignore");
    if (passed) nowPassing.push(file);
    else stillFailing.push(file);
  }
  if (nowPassing.length > 0) {
    console.error("Quarantined test files that now pass:");
    for (const file of nowPassing) console.error(`- ${file}`);
    console.error(`Remove them from ${quarantinePath}.`);
    process.exit(1);
  }
  console.log(`Quarantine verified: ${stillFailing.length} file(s) still fail.`);
}

async function trackedTestFiles(): Promise<string[]> {
  const listed = Bun.spawn(["git", "ls-files", "-z"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(listed.stdout).text();
  if ((await listed.exited) !== 0) {
    throw new Error("could not list repository files");
  }
  return stdout
    .split("\0")
    .filter((path) => /(?:\.test\.tsx?|_test\.ts)$/u.test(path))
    .sort();
}

async function runTests(
  files: readonly string[],
  output: "inherit" | "ignore",
): Promise<boolean> {
  if (files.length === 0) return false;
  const child = Bun.spawn(["bun", "test", ...files], {
    cwd: root,
    stdin: "ignore",
    stdout: output,
    stderr: output,
  });
  return (await child.exited) === 0;
}
