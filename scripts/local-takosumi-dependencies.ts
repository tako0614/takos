import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
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
  ".aws",
  ".azure",
  ".certificates",
  ".certs",
  ".credentials",
  ".docker",
  ".gcloud",
  ".git",
  ".gnupg",
  ".kube",
  ".password-store",
  ".secret",
  ".secrets",
  ".ssh",
  ".terraform",
  ".wrangler",
  "cert",
  "certificate",
  "certificates",
  "certs",
  "credential",
  "credentials",
  "node_modules",
  "secret",
  "secrets",
]);

const excludedSecretExtensions = new Set([
  ".cer",
  ".crt",
  ".der",
  ".jks",
  ".key",
  ".kdbx",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
  ".pkcs8",
]);

const excludedSecretFileNames = [
  ".dev.vars",
  ".dockercfg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "application_default_credentials.json",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
  "service-account.json",
] as const;

const placeholderSuffixes = [
  ".example",
  ".fixture",
  ".sample",
  ".template",
] as const;

const symbolicLinkError =
  "adjacent Takosumi source contains a symbolic link; local:e2e refuses to copy it";

function isPlaceholderName(name: string): boolean {
  return placeholderSuffixes.some((suffix) => name.endsWith(suffix));
}

function hasSecretFileName(name: string): boolean {
  if (isPlaceholderName(name)) return false;
  if (name.endsWith(".pub")) return false;
  return excludedSecretFileNames.some(
    (secretName) => name === secretName || name.startsWith(`${secretName}.`),
  );
}

function isExcludedSourcePath(takosumiRoot: string, source: string): boolean {
  const relativePath = relative(takosumiRoot, source);
  if (!relativePath) return false;
  const parts = relativePath.split(sep);
  if (parts.some((part) => excludedDirectoryNames.has(part))) return true;
  const name = basename(source).toLowerCase();
  if (hasSecretFileName(name)) return true;
  if (!isPlaceholderName(name)) {
    if (name === ".env" || name.startsWith(".env.")) return true;
    if (name === ".dev.vars" || name.startsWith(".dev.vars.")) return true;
    for (const extension of excludedSecretExtensions) {
      if (name.endsWith(extension)) return true;
    }
  }
  return false;
}

async function shouldCopySourcePath(
  takosumiRoot: string,
  source: string,
): Promise<boolean> {
  if (isExcludedSourcePath(takosumiRoot, source)) return false;
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(symbolicLinkError);
  return true;
}

async function assertNoCopiedSourceSymlinks(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(symbolicLinkError);
    if (entry.isDirectory()) {
      await assertNoCopiedSourceSymlinks(join(path, entry.name));
    }
  }
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
      dereference: false,
      verbatimSymlinks: true,
      filter: (source) => shouldCopySourcePath(takosumiRoot, source),
    });
    await assertNoCopiedSourceSymlinks(workspaceRoot);
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
