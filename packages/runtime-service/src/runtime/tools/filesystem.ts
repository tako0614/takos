import fs from "node:fs/promises";
import path from "node:path";

import { SymlinkEscapeError } from "../../shared/errors.ts";
import { type FilePermission, parseFilePermission } from "./permissions.ts";

type SandboxFs = {
  readFile: (
    filePath: string,
    encoding?: string | null,
  ) => Promise<string | Uint8Array>;
  writeFile: (
    filePath: string,
    data: string | Uint8Array,
    encoding?: string | null,
  ) => Promise<void>;
  readdir: (dirPath: string) => Promise<string[]>;
  stat: (targetPath: string) => Promise<Awaited<ReturnType<typeof fs.stat>>>;
  mkdir: (
    dirPath: string,
    options?: Parameters<typeof fs.mkdir>[1],
  ) => Promise<string | undefined>;
  rm: (
    targetPath: string,
    options?: Parameters<typeof fs.rm>[1],
  ) => Promise<void>;
};

function isWithinBase(
  baseDir: string,
  targetPath: string,
  allowBase: boolean,
): boolean {
  const relativePath = path.relative(baseDir, targetPath);
  if (relativePath === "" || relativePath === ".") {
    return allowBase;
  }
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function resolveSandboxPath(
  baseDir: string,
  targetPath: string,
  label: string,
  allowBase = false,
): string {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    throw new Error(`Invalid ${label} path`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, targetPath);
  if (!isWithinBase(resolvedBase, resolvedPath, allowBase)) {
    throw new Error(`Invalid ${label} path`);
  }
  return resolvedPath;
}

async function resolveSandboxExistingPath(
  baseDir: string,
  targetPath: string,
  label: string,
  allowBase = false,
): Promise<string> {
  const resolvedPath = resolveSandboxPath(
    baseDir,
    targetPath,
    label,
    allowBase,
  );
  const resolvedBase = await realpathOrResolved(baseDir);
  const resolvedTarget = await fs.realpath(resolvedPath);
  if (!isWithinBase(resolvedBase, resolvedTarget, true)) {
    throw new SymlinkEscapeError(label);
  }
  return resolvedTarget;
}

async function resolveSandboxWritablePath(
  baseDir: string,
  targetPath: string,
  label: string,
  allowBase = false,
): Promise<string> {
  const resolvedPath = resolveSandboxPath(
    baseDir,
    targetPath,
    label,
    allowBase,
  );
  await verifyWritablePathWithinBase(baseDir, resolvedPath, label);
  return resolvedPath;
}

async function realpathOrResolved(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

async function verifyWritablePathWithinBase(
  baseDir: string,
  targetPath: string,
  label: string,
): Promise<void> {
  const resolvedBase = await realpathOrResolved(baseDir);
  let candidatePath = path.resolve(targetPath);

  while (true) {
    try {
      const resolvedCandidate = await fs.realpath(candidatePath);
      if (!isWithinBase(resolvedBase, resolvedCandidate, true)) {
        throw new SymlinkEscapeError(label);
      }
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        throw err;
      }

      const parentPath = path.dirname(candidatePath);
      if (parentPath === candidatePath) {
        throw new Error(`Invalid ${label} path`);
      }
      candidatePath = parentPath;
    }
  }
}

function createPermissionError(
  permission: FilePermission,
  operation: string,
): Error {
  return new Error(
    `Filesystem access denied: ${operation} requires filePermission=${permission}`,
  );
}

function assertReadable(permission: FilePermission, operation: string): void {
  if (permission === "none") {
    throw createPermissionError(permission, operation);
  }
}

function assertWritable(permission: FilePermission, operation: string): void {
  if (permission !== "write") {
    throw createPermissionError(permission, operation);
  }
}

export function createSandboxFilesystem(
  filePermission: unknown,
  baseDir: string,
): SandboxFs {
  const permission = parseFilePermission(filePermission);

  return {
    async readFile(filePath, encoding = "utf-8") {
      assertReadable(permission, "readFile");
      const resolvedPath = await resolveSandboxExistingPath(
        baseDir,
        filePath,
        "file",
      );
      return encoding === null
        ? await fs.readFile(resolvedPath)
        : await fs.readFile(resolvedPath, encoding as never);
    },
    async writeFile(filePath, data, encoding = "utf-8") {
      assertWritable(permission, "writeFile");
      const resolvedPath = await resolveSandboxWritablePath(
        baseDir,
        filePath,
        "file",
      );
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      if (typeof data === "string") {
        if (encoding === null) {
          await fs.writeFile(resolvedPath, data);
        } else {
          await fs.writeFile(resolvedPath, data, encoding as never);
        }
      } else {
        await fs.writeFile(resolvedPath, data);
      }
    },
    async readdir(dirPath) {
      assertReadable(permission, "readdir");
      const resolvedPath = await resolveSandboxExistingPath(
        baseDir,
        dirPath,
        "directory",
        true,
      );
      return await fs.readdir(resolvedPath);
    },
    async stat(targetPath) {
      assertReadable(permission, "stat");
      const resolvedPath = await resolveSandboxExistingPath(
        baseDir,
        targetPath,
        "target",
        true,
      );
      return await fs.stat(resolvedPath);
    },
    async mkdir(dirPath, options) {
      assertWritable(permission, "mkdir");
      const resolvedPath = await resolveSandboxWritablePath(
        baseDir,
        dirPath,
        "directory",
        true,
      );
      return await fs.mkdir(resolvedPath, options);
    },
    async rm(targetPath, options) {
      assertWritable(permission, "rm");
      const resolvedPath = await resolveSandboxWritablePath(
        baseDir,
        targetPath,
        "target",
        true,
      );
      await fs.rm(resolvedPath, options);
    },
  };
}
