import path from 'path';
import fs from 'fs';
import { REPOS_BASE_DIR, WORKDIR_BASE_DIR } from '../shared/config.js';
import { SymlinkEscapeError, SymlinkNotAllowedError } from '../shared/errors.js';

// --- isPathWithinBase ---

function normalizePathForComparison(resolvedPath: string): string {
  const normalized = resolvedPath.normalize('NFC');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

interface PathWithinBaseOptions {
  allowBase?: boolean;
  resolveInputs?: boolean;
}

export function isPathWithinBase(
  basePath: string,
  targetPath: string,
  options: PathWithinBaseOptions = {}
): boolean {
  const { allowBase = true, resolveInputs = false } = options;
  const normalizedBase = normalizePathForComparison(resolveInputs ? path.resolve(basePath) : basePath);
  const normalizedPath = normalizePathForComparison(resolveInputs ? path.resolve(targetPath) : targetPath);
  const relativePath = path.relative(normalizedBase, normalizedPath);

  if (relativePath === '' || relativePath === '.') {
    return allowBase;
  }

  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export function resolvePathWithin(
  baseDir: string,
  targetPath: string,
  label: string,
  allowBase: boolean = false,
  allowAbsolute: boolean = false
): string {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error(`Invalid ${label} path`);
  }

  if (!allowAbsolute && path.isAbsolute(targetPath)) {
    throw new Error(`Absolute ${label} paths are not allowed`);
  }

  if (!allowAbsolute && targetPath.includes('..')) {
    throw new Error(`Path traversal not allowed in ${label}`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(baseDir, targetPath);

  if (!isPathWithinBase(resolvedBase, resolvedPath, { allowBase })) {
    throw new Error(`Invalid ${label} path`);
  }
  return resolvedPath;
}

export async function verifyPathWithinAfterAccess(
  baseDir: string,
  targetPath: string,
  label: string
): Promise<string> {
  const resolvedBase = await fs.promises.realpath(baseDir).catch(() => path.resolve(baseDir));
  const resolvedPath = await fs.promises.realpath(targetPath);

  if (!isPathWithinBase(resolvedBase, resolvedPath, { allowBase: true })) {
    throw new SymlinkEscapeError(label);
  }

  return resolvedPath;
}

export async function verifyPathWithinBeforeCreate(
  baseDir: string,
  targetPath: string,
  label: string
): Promise<void> {
  const resolvedBase = await fs.promises.realpath(baseDir).catch(() => path.resolve(baseDir));
  let candidatePath = path.resolve(targetPath);

  while (true) {
    try {
      const resolvedCandidate = await fs.promises.realpath(candidatePath);
      if (!isPathWithinBase(resolvedBase, resolvedCandidate, { allowBase: true })) {
        throw new SymlinkEscapeError(label);
      }
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        const parentPath = path.dirname(candidatePath);
        if (parentPath === candidatePath) {
          throw new Error(`Invalid ${label} path`);
        }
        candidatePath = parentPath;
        continue;
      }
      throw err;
    }
  }
}

export async function verifyNoSymlinkPathComponents(
  baseDir: string,
  targetPath: string,
  label: string
): Promise<void> {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);

  if (!isPathWithinBase(resolvedBase, resolvedTarget, { allowBase: true })) {
    throw new Error(`Invalid ${label} path`);
  }

  const relativePath = path.relative(resolvedBase, resolvedTarget);
  if (relativePath === '' || relativePath === '.') {
    return;
  }

  const pathParts = relativePath.split(path.sep).filter(Boolean);
  let currentPath = resolvedBase;

  for (const pathPart of pathParts) {
    currentPath = path.join(currentPath, pathPart);
    try {
      const stats = await fs.promises.lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new SymlinkNotAllowedError(label);
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}

export function resolveRepoGitPath(repoGitPath: string): string {
  const resolvedPath = path.resolve(repoGitPath);

  if (!path.isAbsolute(repoGitPath) ||
      !repoGitPath.endsWith('.git') ||
      !isPathWithinBase(path.resolve(REPOS_BASE_DIR), resolvedPath, { allowBase: false })) {
    throw new Error('Invalid repoGitPath');
  }

  return resolvedPath;
}

function validateRepoNameComponent(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value.length > 128) {
    throw new Error(`${label} too long (max 128 characters)`);
  }
  const safeValue = value.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeValue !== value) {
    throw new Error(`${label} contains invalid characters (only alphanumeric, underscore, and hyphen allowed)`);
  }
  if (!/^[a-zA-Z0-9]/.test(value)) {
    throw new Error(`${label} must start with an alphanumeric character`);
  }
  return safeValue;
}

export function getRepoPath(spaceId: string, repoName: string): string {
  const validatedWorkspaceId = validateRepoNameComponent(spaceId, 'spaceId');
  const validatedRepoName = validateRepoNameComponent(repoName, 'repoName');
  return path.join(REPOS_BASE_DIR, validatedWorkspaceId, `${validatedRepoName}.git`);
}

export function resolveWorkDirPath(targetPath: string, label: string): string {
  return resolvePathWithin(WORKDIR_BASE_DIR, targetPath, label, false, true);
}
