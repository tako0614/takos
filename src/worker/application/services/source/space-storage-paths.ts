import { sourceServiceDeps } from "./deps.ts";
import { MAX_PATH_LENGTH, StorageError } from "./space-storage-shared.ts";

export function normalizePath(path: string): string {
  let normalized = path.replace(/\/+/g, "/").replace(/\/+$/, "");
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  return normalized;
}

export function validateFullPath(path: string): void {
  if (path.length > MAX_PATH_LENGTH) {
    throw new StorageError(
      `Path too long (max ${MAX_PATH_LENGTH} characters)`,
      "VALIDATION",
    );
  }
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new StorageError(
        "Invalid path: path traversal not allowed",
        "VALIDATION",
      );
    }
  }
}

export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.substring(0, lastSlash);
}

export function buildFullPath(parentPath: string, name: string): string {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

export function escapeSqlLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(
    /_/g,
    "\\_",
  );
}

export function buildDescendantPathPattern(path: string): string {
  return `${escapeSqlLike(`${path}/`)}%`;
}

export function ensureValidStorageName(
  name: string,
  errorMessage: string,
): string {
  if (!sourceServiceDeps.validatePathSegment(name)) {
    throw new StorageError(errorMessage, "VALIDATION");
  }
  return name;
}

interface PreparedStorageChildPath {
  parentPath: string;
  fullPath: string;
}

export function prepareStorageChildPath(
  name: string,
  parentPath: string | undefined,
  invalidNameMessage: string,
): PreparedStorageChildPath {
  const validatedName = ensureValidStorageName(name, invalidNameMessage);
  const normalizedParentPath = normalizePath(parentPath ?? "/");
  const fullPath = buildFullPath(normalizedParentPath, validatedName);
  validateFullPath(fullPath);
  return {
    parentPath: normalizedParentPath,
    fullPath,
  };
}

interface ParsedStorageFilePath {
  normalizedPath: string;
  parentPath: string;
  fileName: string;
}

export function parseStorageFilePath(path: string): ParsedStorageFilePath {
  const normalizedPath = normalizePath(path);
  validateFullPath(normalizedPath);
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new StorageError("Invalid file path", "VALIDATION");
  }
  const fileName = ensureValidStorageName(
    parts[parts.length - 1],
    "Invalid file name",
  );
  return {
    normalizedPath,
    parentPath: parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/",
    fileName,
  };
}

export function resolveStorageFileCreationPath(
  path: string,
): { name: string; normalizedPath: string; parentPath: string } {
  const { fileName, normalizedPath, parentPath } = parseStorageFilePath(path);
  return { name: fileName, normalizedPath, parentPath };
}
