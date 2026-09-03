#!/usr/bin/env bun

/**
 * Portable test runner.
 *
 * Every `*.test.ts(x)` and `*_test.ts` file the repository tracks is part of
 * the gate. What is not part of it has to be named, with a reason, in
 * `quality/test-quarantine.json`, and the count is printed on every run.
 *
 * The list this replaced was an allowlist in `package.json` naming 53 of 210
 * test files, so a file left out of it was indistinguishable from a file that
 * did not exist. Three of the paths in it were even appended to
 * `bun run test:opentofu`, a script that never reads its arguments, so they
 * were listed as running while running nowhere.
 *
 * `--verify-quarantine` runs the quarantined files instead, and fails on any
 * that now pass: a quarantine entry is a claim that the file fails today, and
 * a claim that stopped being true has to leave the ledger.
 */

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const quarantinePath = "quality/test-quarantine.json";

type Quarantine = {
  readonly note: string;
  readonly totals: { readonly files: number };
  readonly files: Readonly<Record<string, string>>;
};

const quarantine = JSON.parse(
  await readFile(resolve(root, quarantinePath), "utf8"),
) as Quarantine;
const quarantined = Object.keys(quarantine.files).sort();
if (quarantined.length !== quarantine.totals.files) {
  console.error(
    `${quarantinePath}: totals say ${quarantine.totals.files} file(s) but ` +
      `${quarantined.length} are listed`,
  );
  process.exit(1);
}
for (const [file, reason] of Object.entries(quarantine.files)) {
  if (typeof reason !== "string" || reason.trim() === "") {
    console.error(`${quarantinePath}: ${file} has no reason`);
    process.exit(1);
  }
}

const tracked = await trackedTestFiles();
const missing = quarantined.filter((file) => !tracked.includes(file));
if (missing.length > 0) {
  console.error(`${quarantinePath} names files that do not exist:`);
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const verifyQuarantine = Bun.argv.includes("--verify-quarantine");
if (verifyQuarantine) {
  const stillFailing: string[] = [];
  const nowPassing: string[] = [];
  for (const file of quarantined) {
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
  console.log(
    `Quarantine verified: ${stillFailing.length} file(s) still fail.`,
  );
  process.exit(0);
}

const selected = tracked.filter((file) => !quarantined.includes(file));
console.log(
  `Running ${selected.length} test file(s); ${quarantined.length} ` +
    `quarantined in ${quarantinePath}.`,
);
const passed = await runTests(selected, "inherit");
process.exit(passed ? 0 : 1);

async function trackedTestFiles(): Promise<string[]> {
  const listed = Bun.spawn(["git", "ls-files", "-z"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([
    new Response(listed.stdout).text(),
    listed.exited,
  ]);
  if ((await listed.exited) !== 0) {
    throw new Error("could not list repository files");
  }
  return stdout
    .split("\0")
    .filter((path) => /(?:\.test\.tsx?|_test\.ts)$/u.test(path))
    .map((path) => relative(".", path))
    .sort();
}

async function runTests(
  files: readonly string[],
  output: "inherit" | "ignore",
): Promise<boolean> {
  if (files.length === 0) return true;
  const child = Bun.spawn(["bun", "test", ...files], {
    cwd: root,
    stdin: "ignore",
    stdout: output,
    stderr: output,
  });
  return (await child.exited) === 0;
}
