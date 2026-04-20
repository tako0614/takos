/**
 * 式評価器で使用する標準関数実装
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { MAX_FROM_JSON_SIZE } from "../constants.ts";
import type { ExecutionContext } from "../workflow-models.ts";

const GLOB_PATTERN_CHARS = /[*?[\]]/;
const REGEXP_META_CHARS = /[|\\{}()[\]^$+?.]/g;

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function containsGlobPattern(pattern: string): boolean {
  return GLOB_PATTERN_CHARS.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathLike(pattern);
  let regex = "^";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === "*") {
      if (normalized[i + 1] === "*") {
        regex += ".*";
        i++;
      } else {
        regex += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += char.replace(REGEXP_META_CHARS, "\\$&");
  }

  regex += "$";
  return new RegExp(regex);
}

function isInsideWorkspace(workspace: string, targetPath: string): boolean {
  const relativePath = relative(workspace, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function collectWorkspaceFiles(workspace: string): string[] {
  const files: string[] = [];
  const queue = [workspace];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (!currentDir) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizePathLike(relative(workspace, absolutePath));
      if (relativePath.length > 0) {
        files.push(relativePath);
      }
    }
  }

  files.sort();
  return files;
}

function resolveWorkspaceFile(
  workspace: string,
  fileOrRelativePath: string,
): string | null {
  const absolutePath = isAbsolute(fileOrRelativePath)
    ? resolve(fileOrRelativePath)
    : resolve(workspace, fileOrRelativePath);

  if (!isInsideWorkspace(workspace, absolutePath)) {
    return null;
  }

  try {
    if (!lstatSync(absolutePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return normalizePathLike(relative(workspace, absolutePath));
}

function hashFileSha256(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

export function fnFormat(args: unknown[]): string {
  const [template, ...values] = args;
  if (template === null || template === undefined) {
    return "";
  }
  let result = String(template);
  for (let i = 0; i < values.length; i++) {
    result = result.split(`{${i}}`).join(String(values[i]));
  }
  return result;
}

export function fnJoin(args: unknown[]): string {
  const [arr, separator = ","] = args;
  if (Array.isArray(arr)) {
    return arr.join(String(separator));
  }
  return String(arr);
}

export function fnToJSON(args: unknown[]): string {
  return JSON.stringify(args[0]);
}

export function fnFromJSON(args: unknown[]): unknown {
  const str = String(args[0]);
  // 攻撃者制御の JSON 文字列による OOM を防ぐため入力サイズを制限
  if (str.length > MAX_FROM_JSON_SIZE) {
    return null;
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

export function fnHashFiles(
  args: unknown[],
  context: ExecutionContext,
): string {
  const includePatterns: string[] = [];
  const excludePatterns: string[] = [];

  for (const arg of args) {
    if (typeof arg !== "string") {
      continue;
    }

    const pattern = arg.trim();
    if (pattern.length === 0) {
      continue;
    }

    if (pattern.startsWith("!") && pattern.length > 1) {
      excludePatterns.push(pattern.slice(1));
    } else {
      includePatterns.push(pattern);
    }
  }

  if (includePatterns.length === 0) {
    return "";
  }

  return evaluateHashFiles(includePatterns, excludePatterns, context);
}

function evaluateHashFiles(
  includePatterns: string[],
  excludePatterns: string[],
  context: ExecutionContext,
): string {
  const workspace = resolve(context.github.workspace || process.cwd());
  const files = collectMatchedHashFiles(
    workspace,
    includePatterns,
    excludePatterns,
  );
  if (files.length === 0) {
    return "";
  }

  const fileHashes = hashFiles(workspace, files);
  if (fileHashes.length === 0) {
    return "";
  }
  if (fileHashes.length === 1) {
    return fileHashes[0];
  }

  const aggregate = createHash("sha256");
  for (const fileHash of fileHashes) {
    aggregate.update(fileHash);
  }
  return aggregate.digest("hex");
}

function collectMatchedHashFiles(
  workspace: string,
  includePatterns: string[],
  excludePatterns: string[],
): string[] {
  const matchedFiles = new Set<string>();
  let workspaceFiles: string[] | undefined;

  const applyPattern = (pattern: string, include: boolean): void => {
    if (containsGlobPattern(pattern)) {
      workspaceFiles ??= collectWorkspaceFiles(workspace);
      const regexp = globToRegExp(pattern);
      for (const file of workspaceFiles) {
        if (regexp.test(file)) {
          if (include) {
            matchedFiles.add(file);
          } else {
            matchedFiles.delete(file);
          }
        }
      }
      return;
    }

    const file = resolveWorkspaceFile(workspace, pattern);
    if (!file) {
      return;
    }
    if (include) {
      matchedFiles.add(file);
    } else {
      matchedFiles.delete(file);
    }
  };

  for (const pattern of includePatterns) {
    applyPattern(pattern, true);
  }
  for (const pattern of excludePatterns) {
    applyPattern(pattern, false);
  }

  return [...matchedFiles].sort();
}

function hashFiles(workspace: string, files: string[]): string[] {
  const fileHashes: string[] = [];
  for (const file of files) {
    const fileHash = hashFileSha256(resolve(workspace, file));
    if (fileHash) {
      fileHashes.push(fileHash);
    }
  }
  return fileHashes;
}

export function fnSuccess(context: ExecutionContext): boolean {
  return context.job.status === "success";
}

export function fnAlways(): boolean {
  return true;
}

export function fnCancelled(context: ExecutionContext): boolean {
  return context.job.status === "cancelled";
}

export function fnFailure(context: ExecutionContext): boolean {
  return context.job.status === "failure";
}
