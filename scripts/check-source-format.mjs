#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkedExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const files = sourceFiles();
const failures = [];

for (const file of files) {
  const relative = path.relative(root, file);
  let source;
  try {
    source = decoder.decode(readFileSync(file));
  } catch {
    failures.push(`${relative}: is not valid UTF-8`);
    continue;
  }

  if (source.includes("\r")) {
    failures.push(`${relative}: must use LF line endings`);
  }
  if (source.length > 0 && !source.endsWith("\n")) {
    failures.push(`${relative}: must end with a newline`);
  }

  for (const [index, line] of source.split("\n").entries()) {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${relative}:${index + 1}: trailing whitespace`);
    }
  }

  if (
    path.extname(file) === ".json" &&
    !path.basename(file).startsWith("tsconfig")
  ) {
    try {
      JSON.parse(source);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${relative}: invalid JSON (${detail})`);
    }
  }
}

if (files.length === 0) {
  console.error("source format check found no JavaScript, TypeScript, or JSON files");
  process.exit(1);
}

if (failures.length > 0) {
  console.error("source format check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`source format check passed (${files.length} files)`);

function sourceFiles() {
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  if (listed.status !== 0) {
    const detail = listed.stderr.trim() || "git ls-files failed";
    console.error(`source format check could not list repository files: ${detail}`);
    process.exit(1);
  }

  return listed.stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => checkedExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file))
    .sort();
}
