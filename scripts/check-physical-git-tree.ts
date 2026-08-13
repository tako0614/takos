import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fileConstants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export type PhysicalGitRunner = (
  root: string,
  args: readonly string[],
) => Promise<string>;

type PhysicalTreeEntry = Readonly<{
  mode: "100644" | "100755" | "120000";
  objectId: string;
  path: string;
}>;

/**
 * Proves the physical checkout bytes against a commit tree without consulting
 * the Git index for content or mode. The index is inspected separately only
 * to reject flags that can blind ordinary status/diff commands.
 */
export async function assertPhysicalGitTreeMatchesCommit(options: {
  readonly root: string;
  readonly commit: string;
  readonly subject: string;
  readonly git?: PhysicalGitRunner;
}): Promise<void> {
  const root = resolve(options.root);
  const rootInfo = await lstat(root);
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (await realpath(root)) !== root
  ) {
    throw new Error(`${options.subject} must be one physical canonical directory`);
  }
  if (!GIT_OBJECT_ID.test(options.commit)) {
    throw new Error(`${options.subject} commit identity is invalid`);
  }

  const git = options.git ?? runGit;
  const indexEntries = await requiredGitRead(
    git,
    root,
    ["ls-files", "-v", "-z"],
    `${options.subject} index flags could not be read`,
  );
  assertNoHiddenIndexEntries(indexEntries, options.subject);
  const objectFormat = await requiredGitRead(
    git,
    root,
    ["rev-parse", "--show-object-format"],
    `${options.subject} object format could not be read`,
  );
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error(`${options.subject} object format is unsupported`);
  }
  const tree = parseTree(
    await requiredGitRead(
      git,
      root,
      ["ls-tree", "-r", "-z", "--full-tree", options.commit],
      `${options.subject} commit tree could not be read`,
    ),
    options.subject,
  );
  const checkedDirectories = new Set<string>([root]);

  for (const entry of tree) {
    await assertPhysicalParentDirectories(
      root,
      entry.path,
      checkedDirectories,
      options.subject,
    );
    const path = join(root, entry.path);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `${options.subject} tracked file is missing from the physical checkout: ${JSON.stringify(entry.path)}`,
        );
      }
      throw error;
    }

    if (entry.mode === "120000") {
      if (!info.isSymbolicLink() || info.nlink !== 1) {
        throw new Error(
          `${options.subject} tracked file type does not match the commit: ${JSON.stringify(entry.path)}`,
        );
      }
      const target = await readlink(path, { encoding: "buffer" });
      const after = await lstat(path);
      if (
        !after.isSymbolicLink() ||
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.nlink !== info.nlink ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs
      ) {
        throw new Error(
          `${options.subject} tracked symlink changed while it was read: ${JSON.stringify(entry.path)}`,
        );
      }
      if (gitBlobObjectId(target, objectFormat) !== entry.objectId) {
        throw new Error(
          `${options.subject} tracked symlink target does not match the commit: ${JSON.stringify(entry.path)}`,
        );
      }
      continue;
    }

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `${options.subject} tracked file type does not match the commit: ${JSON.stringify(entry.path)}`,
      );
    }
    if (info.nlink !== 1) {
      throw new Error(
        `${options.subject} tracked file must be one physical file: ${JSON.stringify(entry.path)}`,
      );
    }
    const physicalMode = (info.mode & 0o111) === 0 ? "100644" : "100755";
    if (physicalMode !== entry.mode) {
      throw new Error(
        `${options.subject} tracked file mode does not match the commit: ${JSON.stringify(entry.path)}`,
      );
    }
    const bytes = await readStablePhysicalFile(path, info, options.subject, entry.path);
    if (gitBlobObjectId(bytes, objectFormat) !== entry.objectId) {
      throw new Error(
        `${options.subject} tracked file content does not match the commit: ${JSON.stringify(entry.path)}`,
      );
    }
  }
}

async function readStablePhysicalFile(
  path: string,
  before: Awaited<ReturnType<typeof lstat>>,
  subject: string,
  relativePath: string,
): Promise<Buffer> {
  const handle = await open(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.mode !== before.mode ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(
        `${subject} tracked file changed before it was read: ${JSON.stringify(relativePath)}`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.nlink !== opened.nlink ||
      after.mode !== opened.mode ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      bytes.byteLength !== opened.size
    ) {
      throw new Error(
        `${subject} tracked file changed while it was read: ${JSON.stringify(relativePath)}`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function gitBlobObjectId(bytes: Uint8Array, objectFormat: "sha1" | "sha256"): string {
  return createHash(objectFormat)
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function parseTree(value: string, subject: string): PhysicalTreeEntry[] {
  const entries: PhysicalTreeEntry[] = [];
  const paths = new Set<string>();
  for (const raw of value.split("\0").filter(Boolean)) {
    const separator = raw.indexOf("\t");
    const metadata = separator < 0 ? [] : raw.slice(0, separator).split(" ");
    const path = separator < 0 ? "" : raw.slice(separator + 1);
    const [mode, type, objectId] = metadata;
    if (
      metadata.length !== 3 ||
      type !== "blob" ||
      !GIT_OBJECT_ID.test(objectId ?? "") ||
      (mode !== "100644" && mode !== "100755" && mode !== "120000") ||
      !isSafeTrackedPath(path) ||
      paths.has(path)
    ) {
      throw new Error(`${subject} commit tree is invalid`);
    }
    paths.add(path);
    entries.push({ mode, objectId: objectId!, path });
  }
  if (entries.length === 0) throw new Error(`${subject} commit tree is empty`);
  return entries;
}

function isSafeTrackedPath(path: string): boolean {
  return path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\uFFFD") &&
    path.split("/").every(
      (component) => component !== "" && component !== "." && component !== "..",
    );
}

async function assertPhysicalParentDirectories(
  root: string,
  relativePath: string,
  checked: Set<string>,
  subject: string,
): Promise<void> {
  const components = relativePath.split("/").slice(0, -1);
  let path = root;
  for (const component of components) {
    path = join(path, component);
    if (checked.has(path)) continue;
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `${subject} tracked parent directory is missing from the physical checkout: ${JSON.stringify(relativePath)}`,
        );
      }
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(
        `${subject} tracked parent path is not a physical directory: ${JSON.stringify(relativePath)}`,
      );
    }
    checked.add(path);
  }
}

function assertNoHiddenIndexEntries(value: string, subject: string): void {
  for (const entry of value.split("\0").filter(Boolean)) {
    if (!/^[A-Za-z?] /u.test(entry)) {
      throw new Error(`${subject} index entry is invalid`);
    }
    const flag = entry[0]!;
    const path = entry.slice(2);
    if (flag === "S" || flag === "s") {
      throw new Error(
        `${subject} index uses skip-worktree: ${JSON.stringify(path)}`,
      );
    }
    if (flag === flag.toLowerCase() && /[a-z]/u.test(flag)) {
      throw new Error(
        `${subject} index uses assume-unchanged: ${JSON.stringify(path)}`,
      );
    }
  }
}

async function requiredGitRead(
  git: PhysicalGitRunner,
  root: string,
  args: readonly string[],
  message: string,
): Promise<string> {
  try {
    return (await git(root, args)).trim();
  } catch {
    throw new Error(message);
  }
}

async function runGit(root: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return result.stdout;
}
