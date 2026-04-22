import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const SCAN_ROOTS = [
  "apps",
  "packages",
  "scripts",
].map((relativePath) => path.join(repoRoot, relativePath));

const SKIP_DIRS = new Set([
  ".git",
  ".pnpm-store",
  "node_modules",
]);

function toRepoRelative(targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

function collectPackageLocks(startDir) {
  if (!existsSync(startDir)) {
    return [];
  }

  const violations = [];
  const stack = [startDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }

        // git サブモジュールのディレクトリは除外する（.git はディレクトリではなくファイルとして存在するため）
        if (existsSync(path.join(fullPath, ".git"))) {
          continue;
        }

        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "package-lock.json") {
        violations.push(toRepoRelative(fullPath));
      }
    }
  }

  return violations;
}

const violations = new Set();

const rootLockfile = path.join(repoRoot, "package-lock.json");
if (existsSync(rootLockfile)) {
  violations.add("package-lock.json");
}

for (const scanRoot of SCAN_ROOTS) {
  for (const violation of collectPackageLocks(scanRoot)) {
    violations.add(violation);
  }
}

const sortedViolations = [...violations].sort();

if (sortedViolations.length > 0) {
  console.error(
    [
      "package-lock.json is not allowed under pnpm-managed roots.",
      "Remove:",
      ...sortedViolations.map((filePath) => ` - ${filePath}`),
    ].join("\n"),
  );
  Deno.exit(1);
}

console.log("No package-lock.json files found under pnpm-managed roots.");
