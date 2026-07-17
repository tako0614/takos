import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";

type PackageDocument = {
  workspaces?: string[] | { packages?: string[] };
};

type PrepareOptions = {
  takosumiRoot: string;
  install: (dependencyRoot: string) => Promise<void>;
  temporaryParent?: string;
};

export type PreparedTakosumiDependencies = {
  workspaceRoot: string;
  nodeModulesPath: string;
  lockDigest: string;
};

const excludedDirectoryNames = new Set([
  ".git",
  ".secrets",
  ".terraform",
  ".wrangler",
  "node_modules",
]);

const excludedSecretExtensions = new Set([
  ".cer",
  ".crt",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
]);

function isSafeSourceCopyPath(takosumiRoot: string, source: string): boolean {
  const relativePath = relative(takosumiRoot, source);
  if (!relativePath) return true;
  const parts = relativePath.split(sep);
  if (parts.some((part) => excludedDirectoryNames.has(part))) return false;
  const name = basename(source).toLowerCase();
  if (
    name === ".env" ||
    (name.startsWith(".env.") && !name.endsWith(".example"))
  ) {
    return false;
  }
  for (const extension of excludedSecretExtensions) {
    if (name.endsWith(extension)) return false;
  }
  return true;
}

function workspaceEntries(document: PackageDocument): string[] {
  if (Array.isArray(document.workspaces)) return document.workspaces;
  if (Array.isArray(document.workspaces?.packages)) {
    return document.workspaces.packages;
  }
  return [];
}

export function takosumiWorkspaceManifestPaths(packageText: string): string[] {
  let document: PackageDocument;
  try {
    document = JSON.parse(packageText) as PackageDocument;
  } catch {
    throw new Error("adjacent Takosumi package.json is not valid JSON");
  }

  return workspaceEntries(document).map((entry) => {
    if (typeof entry !== "string" || entry.trim() !== entry || !entry) {
      throw new Error("Takosumi workspace entries must be non-empty paths");
    }
    if (isAbsolute(entry) || entry.includes("*") || entry.includes("?")) {
      throw new Error(
        `Takosumi workspace path must be an explicit relative directory: ${entry}`,
      );
    }
    const normalized = normalize(entry);
    if (
      normalized === ".." ||
      normalized.startsWith(`..${sep}`) ||
      normalized === "."
    ) {
      throw new Error(
        `Takosumi workspace path escapes or aliases its root: ${entry}`,
      );
    }
    return join(normalized, "package.json");
  });
}

async function requireFile(path: string, label: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(`${label} is missing: ${path}`);
  }
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

async function requireDirectory(path: string, label: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(`${label} is missing: ${path}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

export async function prepareTakosumiDependencies(
  options: PrepareOptions,
): Promise<PreparedTakosumiDependencies> {
  const takosumiRoot = resolve(options.takosumiRoot);
  const packagePath = join(takosumiRoot, "package.json");
  const lockPath = join(takosumiRoot, "bun.lock");
  await requireFile(packagePath, "adjacent Takosumi package manifest");
  await requireFile(lockPath, "adjacent Takosumi frozen lockfile");
  await requireFile(
    join(takosumiRoot, "core", "index.ts"),
    "adjacent Takosumi service entrypoint",
  );

  const [packageText, lockBytes] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(lockPath),
  ]);
  const workspaceManifests = takosumiWorkspaceManifestPaths(packageText);
  for (const relativeManifest of workspaceManifests) {
    await requireFile(
      join(takosumiRoot, relativeManifest),
      `Takosumi workspace manifest ${relativeManifest}`,
    );
  }

  const temporaryParent = resolve(options.temporaryParent ?? tmpdir());
  await mkdir(temporaryParent, { recursive: true });
  const workspaceRoot = await mkdtemp(
    join(temporaryParent, "takos-local-e2e-takosumi-deps-"),
  );

  try {
    await cp(takosumiRoot, workspaceRoot, {
      recursive: true,
      force: false,
      filter: (source) => isSafeSourceCopyPath(takosumiRoot, source),
    });
    await options.install(workspaceRoot);
    const nodeModulesPath = join(workspaceRoot, "node_modules");
    await requireDirectory(
      nodeModulesPath,
      "isolated Takosumi frozen dependency installation",
    );
    return {
      workspaceRoot,
      nodeModulesPath,
      lockDigest: createHash("sha256").update(lockBytes).digest("hex"),
    };
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupTakosumiDependencies(
  prepared: PreparedTakosumiDependencies | null,
): Promise<void> {
  if (!prepared) return;
  await rm(prepared.workspaceRoot, { recursive: true, force: true });
}
