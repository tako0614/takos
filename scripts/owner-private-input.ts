import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export class OwnerPrivateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerPrivateInputError";
  }
}

function fail(message: string): never {
  throw new OwnerPrivateInputError(message);
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) {
    return fail("owner-private input requires an operating system user id");
  }
  return uid;
}

function modeOf(mode: number): number {
  return mode & 0o777;
}

async function assertCanonical(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) fail(`${label} must be an absolute path`);
  const normalized = resolve(path);
  let canonical: string;
  try {
    canonical = await realpath(normalized);
  } catch {
    fail(`${label} is not readable`);
  }
  if (canonical !== normalized) {
    fail(`${label} must be canonical and contain no symbolic link`);
  }
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(normalized);
  } catch {
    fail(`${label} changed during canonical-path validation`);
  }
  if (entry.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  return normalized;
}

function assertOutsideRepository(path: string, repositoryRoot: string): void {
  const fromRoot = relative(resolve(repositoryRoot), path);
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) {
    fail("owner-private input must be outside the public repository");
  }
}

export async function assertOwnerPrivateDirectory(
  path: string,
  options: { repositoryRoot: string },
): Promise<string> {
  const canonical = await assertCanonical(path, "owner-private directory");
  assertOutsideRepository(canonical, options.repositoryRoot);
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(canonical);
  } catch {
    fail("owner-private directory changed during validation");
  }
  if (!metadata.isDirectory()) fail("owner-private directory is not a directory");
  if (metadata.uid !== currentUid()) {
    fail("owner-private directory must be owned by the current user");
  }
  if (modeOf(metadata.mode) !== PRIVATE_DIRECTORY_MODE) {
    fail("owner-private directory must have mode 0700");
  }
  return canonical;
}

export async function assertOwnerPrivateFile(
  path: string,
  options: { repositoryRoot: string; maxBytes?: number },
): Promise<string> {
  const canonical = await assertCanonical(path, "owner-private file");
  assertOutsideRepository(canonical, options.repositoryRoot);
  await assertOwnerPrivateDirectory(dirname(canonical), options);
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(canonical);
  } catch {
    fail("owner-private file changed during validation");
  }
  if (!metadata.isFile()) fail("owner-private file must be a regular file");
  if (metadata.uid !== currentUid()) {
    fail("owner-private file must be owned by the current user");
  }
  if (modeOf(metadata.mode) !== PRIVATE_FILE_MODE) {
    fail("owner-private file must have mode 0600");
  }
  if (metadata.nlink !== 1) {
    fail("owner-private file must have exactly one hard link");
  }
  if (metadata.size > (options.maxBytes ?? 256 * 1024)) {
    fail("owner-private file exceeds its size bound");
  }
  return canonical;
}

export async function assertExactOwnerPrivateDirectory(
  path: string,
  names: readonly string[],
  options: { repositoryRoot: string; maxFileBytes?: number },
): Promise<Readonly<Record<string, string>>> {
  const canonical = await assertOwnerPrivateDirectory(path, options);
  const expected = [...names].sort();
  let actual: string[];
  try {
    actual = (await readdir(canonical)).sort();
  } catch {
    fail("owner-private directory changed while listing its fixed closure");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `owner-private directory must contain exactly ${expected.join(", ")}`,
    );
  }
  const files: Record<string, string> = {};
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) {
      fail(`owner-private file name ${name} is not fixed uppercase identity`);
    }
    files[name] = await assertOwnerPrivateFile(resolve(canonical, name), {
      repositoryRoot: options.repositoryRoot,
      maxBytes: options.maxFileBytes,
    });
  }
  return files;
}

export async function readOwnerPrivateFile(
  path: string,
  options: { repositoryRoot: string; maxBytes?: number },
): Promise<string> {
  const canonical = await assertOwnerPrivateFile(path, options);
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(canonical, flags);
  } catch {
    fail("owner-private file could not be opened safely");
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== currentUid() ||
      modeOf(metadata.mode) !== PRIVATE_FILE_MODE ||
      metadata.nlink !== 1 ||
      metadata.size > maxBytes
    ) {
      fail("owner-private file changed while it was being opened");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let totalBytes = 0;
    while (totalBytes < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytes,
        buffer.byteLength - totalBytes,
        totalBytes,
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    if (totalBytes > maxBytes) fail("owner-private file exceeds its size bound");
    return buffer.subarray(0, totalBytes).toString("utf8");
  } catch (error) {
    if (error instanceof OwnerPrivateInputError) throw error;
    return fail("owner-private file could not be read safely");
  } finally {
    await handle.close().catch(() => undefined);
  }
}
