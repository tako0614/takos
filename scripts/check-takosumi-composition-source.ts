#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const PIN_KIND = "takos.takosumi-composition-source@v1" as const;
const REPOSITORY = "tako0614/takosumi" as const;
const PIN_FILENAME = "takosumi-composition-source.json";
const COMMIT = /^[0-9a-f]{40}$/u;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export type TakosumiCompositionSourcePin = Readonly<{
  kind: typeof PIN_KIND;
  repository: typeof REPOSITORY;
  commit: string;
}>;

export type TakosumiCompositionSourceIdentity = TakosumiCompositionSourcePin &
  Readonly<{ pinDigest: `sha256:${string}` }>;

export type TakosumiCompositionCheckout = Readonly<{
  expectedRoot: string;
  gitRoot: string;
  headCommit: string;
  status: string;
  originUrl: string;
  originMainCommit: string;
  remoteMainCommit: string;
  pinIsAncestorOfOriginMain: boolean;
}>;

export type GitRunner = (
  root: string,
  args: readonly string[],
) => Promise<string>;

type PinnedTreeEntry = Readonly<{
  mode: "100644" | "100755" | "120000";
  objectId: string;
  path: string;
}>;

export function parseTakosumiCompositionSourcePin(
  value: unknown,
): TakosumiCompositionSourcePin {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Takosumi composition source pin is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "commit,kind,repository" ||
    record.kind !== PIN_KIND ||
    record.repository !== REPOSITORY ||
    typeof record.commit !== "string" ||
    !COMMIT.test(record.commit)
  ) {
    throw new Error("Takosumi composition source pin is invalid");
  }
  return {
    kind: PIN_KIND,
    repository: REPOSITORY,
    commit: record.commit,
  };
}

export function parseTakosumiCompositionSourceIdentity(
  value: unknown,
): TakosumiCompositionSourceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Takosumi composition source identity is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "commit,kind,pinDigest,repository" ||
    record.kind !== PIN_KIND ||
    record.repository !== REPOSITORY ||
    typeof record.commit !== "string" ||
    !COMMIT.test(record.commit) ||
    typeof record.pinDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(record.pinDigest)
  ) {
    throw new Error("Takosumi composition source identity is invalid");
  }
  return {
    kind: PIN_KIND,
    repository: REPOSITORY,
    commit: record.commit,
    pinDigest: record.pinDigest as `sha256:${string}`,
  };
}

export function assertTakosumiCompositionSourceIdentityMatch(
  expected: TakosumiCompositionSourceIdentity,
  actual: TakosumiCompositionSourceIdentity,
): void {
  if (
    expected.kind !== actual.kind ||
    expected.repository !== actual.repository ||
    expected.commit !== actual.commit ||
    expected.pinDigest !== actual.pinDigest
  ) {
    throw new Error(
      "Takosumi composition source does not match the current pinned checkout",
    );
  }
}

export function assertTakosumiCompositionCheckout(
  pin: TakosumiCompositionSourcePin,
  checkout: TakosumiCompositionCheckout,
): void {
  if (checkout.gitRoot !== checkout.expectedRoot) {
    throw new Error(
      "Takosumi composition source must be the exact physical ../takosumi Git root",
    );
  }
  if (!isCanonicalTakosumiOrigin(checkout.originUrl)) {
    throw new Error(
      "Takosumi composition source origin must be the canonical GitHub repository",
    );
  }
  if (checkout.headCommit !== pin.commit) {
    throw new Error(
      `Takosumi composition source HEAD ${checkout.headCommit || "<missing>"} does not match pinned commit ${pin.commit}`,
    );
  }
  if (checkout.status.trim()) {
    throw new Error(
      `Takosumi composition source must be clean:\n${checkout.status.trim()}`,
    );
  }
  if (checkout.originMainCommit !== checkout.remoteMainCommit) {
    throw new Error(
      "Takosumi local origin/main does not match live origin/main",
    );
  }
  if (!checkout.pinIsAncestorOfOriginMain) {
    throw new Error(
      "Takosumi pinned commit is not in the canonical live main history",
    );
  }
}

export async function readTakosumiCompositionSourceIdentity(
  takosRoot: string,
): Promise<TakosumiCompositionSourceIdentity> {
  const root = await realpath(resolve(takosRoot));
  const pinPath = join(root, PIN_FILENAME);
  let entry;
  try {
    entry = await lstat(pinPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Takosumi composition source pin is missing: ${pinPath}`);
    }
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
    throw new Error("Takosumi composition source pin must be one physical file");
  }
  if ((await realpath(pinPath)) !== pinPath) {
    throw new Error("Takosumi composition source pin path is not physical");
  }
  const bytes = await readFile(pinPath);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Takosumi composition source pin is invalid JSON");
  }
  const pin = parseTakosumiCompositionSourcePin(value);
  return {
    ...pin,
    pinDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export async function verifyTakosumiCompositionSource(options?: {
  readonly takosRoot?: string;
  readonly git?: GitRunner;
}): Promise<TakosumiCompositionSourceIdentity> {
  const takosRoot = await realpath(
    resolve(options?.takosRoot ?? join(import.meta.dir, "..")),
  );
  const expectedRoot = resolve(dirname(takosRoot), "takosumi");
  const pin = await readTakosumiCompositionSourceIdentity(takosRoot);
  let sourceEntry;
  try {
    sourceEntry = await lstat(expectedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Takosumi composition source is missing: expected physical sibling ${expectedRoot}`,
      );
    }
    throw error;
  }
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new Error(
      "Takosumi composition source must be a physical directory, not a symlink",
    );
  }
  const sourceRoot = await realpath(expectedRoot);
  if (sourceRoot !== expectedRoot) {
    throw new Error(
      "Takosumi composition source must be the physical ../takosumi sibling",
    );
  }

  const git = options?.git ?? runGit;
  const gitRoot = await requiredGitRead(
    git,
    sourceRoot,
    ["rev-parse", "--show-toplevel"],
    "Takosumi composition source must be an exact Git checkout",
  );
  const headCommit = await requiredGitRead(
    git,
    sourceRoot,
    ["rev-parse", "--verify", "HEAD"],
    "Takosumi composition source HEAD could not be resolved",
  );
  const indexEntries = await requiredGitRead(
    git,
    sourceRoot,
    ["ls-files", "-v", "-z"],
    "Takosumi composition source index flags could not be read",
  );
  assertNoHiddenIndexEntries(indexEntries);
  await assertPhysicalTrackedTreeMatchesPin(git, sourceRoot, pin.commit);
  const status = await requiredGitRead(
    git,
    sourceRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "Takosumi composition source status could not be read",
  );
  const originUrl = await requiredGitRead(
    git,
    sourceRoot,
    ["remote", "get-url", "origin"],
    "Takosumi composition source origin is missing",
  );
  const originMainCommit = await requiredGitRead(
    git,
    sourceRoot,
    ["rev-parse", "--verify", "refs/remotes/origin/main"],
    "Takosumi local origin/main is missing",
  );
  const remoteMainOutput = await requiredGitRead(
    git,
    sourceRoot,
    ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    "Takosumi live origin/main could not be resolved",
  );
  const remoteMainCommit = remoteMainOutput.split(/\s+/u)[0] ?? "";
  if (!COMMIT.test(remoteMainCommit)) {
    throw new Error("Takosumi live origin/main could not be resolved");
  }
  const pinIsAncestorOfOriginMain = await gitSucceeds(git, sourceRoot, [
    "merge-base",
    "--is-ancestor",
    pin.commit,
    originMainCommit,
  ]);
  assertTakosumiCompositionCheckout(pin, {
    expectedRoot,
    gitRoot: await realpath(resolve(gitRoot)),
    headCommit,
    status,
    originUrl,
    originMainCommit,
    remoteMainCommit,
    pinIsAncestorOfOriginMain,
  });
  return pin;
}

async function assertPhysicalTrackedTreeMatchesPin(
  git: GitRunner,
  sourceRoot: string,
  commit: string,
): Promise<void> {
  const tree = parsePinnedTree(
    await requiredGitRead(
      git,
      sourceRoot,
      ["ls-tree", "-r", "-z", "--full-tree", commit],
      "Takosumi pinned composition tree could not be read",
    ),
  );
  const checkedDirectories = new Set<string>([sourceRoot]);
  const regularEntries: PinnedTreeEntry[] = [];

  for (const entry of tree) {
    await assertPhysicalParentDirectories(
      sourceRoot,
      entry.path,
      checkedDirectories,
    );
    const path = join(sourceRoot, entry.path);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Takosumi tracked file is missing from the physical checkout: ${JSON.stringify(entry.path)}`,
        );
      }
      throw error;
    }

    if (entry.mode === "120000") {
      if (!info.isSymbolicLink()) {
        throw new Error(
          `Takosumi tracked file type does not match pinned commit: ${JSON.stringify(entry.path)}`,
        );
      }
      const target = await readlink(path);
      const objectId = hashPhysicalGitObject(sourceRoot, target);
      if (objectId !== entry.objectId) {
        throw new Error(
          `Takosumi tracked symlink target does not match pinned commit: ${JSON.stringify(entry.path)}`,
        );
      }
      continue;
    }

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `Takosumi tracked file type does not match pinned commit: ${JSON.stringify(entry.path)}`,
      );
    }
    if (info.nlink !== 1) {
      throw new Error(
        `Takosumi tracked file must be one physical file: ${JSON.stringify(entry.path)}`,
      );
    }
    const physicalMode = (info.mode & 0o111) === 0 ? "100644" : "100755";
    if (physicalMode !== entry.mode) {
      throw new Error(
        `Takosumi tracked file mode does not match pinned commit: ${JSON.stringify(entry.path)}`,
      );
    }
    regularEntries.push(entry);
  }

  const objectIds = hashPhysicalGitPaths(
    sourceRoot,
    regularEntries.map((entry) => entry.path),
  );
  if (objectIds.length !== regularEntries.length) {
    throw new Error("Takosumi physical tracked-file manifest is incomplete");
  }
  for (const [index, entry] of regularEntries.entries()) {
    if (objectIds[index] !== entry.objectId) {
      throw new Error(
        `Takosumi tracked file content does not match pinned commit: ${JSON.stringify(entry.path)}`,
      );
    }
  }
}

function parsePinnedTree(value: string): PinnedTreeEntry[] {
  const entries: PinnedTreeEntry[] = [];
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
      throw new Error("Takosumi pinned composition tree is invalid");
    }
    paths.add(path);
    entries.push({ mode, objectId: objectId!, path });
  }
  if (entries.length === 0) {
    throw new Error("Takosumi pinned composition tree is empty");
  }
  return entries;
}

function isSafeTrackedPath(path: string): boolean {
  return path.length > 0 &&
    !path.startsWith("/") &&
    path.split("/").every(
      (component) => component !== "" && component !== "." && component !== "..",
    );
}

async function assertPhysicalParentDirectories(
  sourceRoot: string,
  relativePath: string,
  checked: Set<string>,
): Promise<void> {
  const components = relativePath.split("/").slice(0, -1);
  let path = sourceRoot;
  for (const component of components) {
    path = join(path, component);
    if (checked.has(path)) continue;
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Takosumi tracked parent directory is missing from the physical checkout: ${JSON.stringify(relativePath)}`,
        );
      }
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(
        `Takosumi tracked parent path is not a physical directory: ${JSON.stringify(relativePath)}`,
      );
    }
    checked.add(path);
  }
}

function hashPhysicalGitPaths(root: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const ordinary: string[] = [];
  const byPath = new Map<string, string>();
  for (const path of paths) {
    if (path.includes("\n")) {
      byPath.set(
        path,
        runPhysicalGit(root, ["hash-object", "--no-filters", "--", path]),
      );
    } else {
      ordinary.push(path);
    }
  }
  if (ordinary.length > 0) {
    const output = runPhysicalGit(
      root,
      ["hash-object", "--no-filters", "--stdin-paths"],
      `${ordinary.join("\n")}\n`,
    );
    const objectIds = output.split("\n").filter(Boolean);
    if (
      objectIds.length !== ordinary.length ||
      objectIds.some((objectId) => !GIT_OBJECT_ID.test(objectId))
    ) {
      throw new Error("Takosumi physical tracked-file manifest is invalid");
    }
    for (const [index, path] of ordinary.entries()) {
      byPath.set(path, objectIds[index]!);
    }
  }
  return paths.map((path) => byPath.get(path) ?? "");
}

function hashPhysicalGitObject(root: string, value: string): string {
  const objectId = runPhysicalGit(root, ["hash-object", "--stdin"], value);
  if (!GIT_OBJECT_ID.test(objectId)) {
    throw new Error("Takosumi physical tracked symlink hash is invalid");
  }
  return objectId;
}

function runPhysicalGit(
  root: string,
  args: readonly string[],
  input?: string,
): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error("Takosumi physical tracked-file manifest could not be read");
  }
  return result.stdout.trim();
}

function assertNoHiddenIndexEntries(value: string): void {
  for (const entry of value.split("\0").filter(Boolean)) {
    if (!/^[A-Za-z?] /u.test(entry)) {
      throw new Error("Takosumi composition source index entry is invalid");
    }
    const flag = entry[0]!;
    const path = entry.slice(2);
    if (flag === "S" || flag === "s") {
      throw new Error(
        `Takosumi composition source index uses skip-worktree: ${JSON.stringify(path)}`,
      );
    }
    if (flag === flag.toLowerCase() && /[a-z]/u.test(flag)) {
      throw new Error(
        `Takosumi composition source index uses assume-unchanged: ${JSON.stringify(path)}`,
      );
    }
  }
}

async function requiredGitRead(
  git: GitRunner,
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
    maxBuffer: 1024 * 1024,
  });
  return result.stdout;
}

async function gitSucceeds(
  git: GitRunner,
  root: string,
  args: readonly string[],
): Promise<boolean> {
  try {
    await git(root, args);
    return true;
  } catch {
    return false;
  }
}

function isCanonicalTakosumiOrigin(value: string): boolean {
  return [
    "https://github.com/tako0614/takosumi",
    "https://github.com/tako0614/takosumi.git",
    "git@github.com:tako0614/takosumi.git",
    "ssh://git@github.com/tako0614/takosumi.git",
  ].includes(value.trim());
}

if (import.meta.main) {
  try {
    if (Bun.argv.length === 3 && Bun.argv[2] === "--print-commit") {
      const identity = await readTakosumiCompositionSourceIdentity(
        resolve(import.meta.dir, ".."),
      );
      process.stdout.write(`${identity.commit}\n`);
    } else if (Bun.argv.length === 2) {
      const identity = await verifyTakosumiCompositionSource();
      process.stdout.write(
        `Takosumi composition source verified: ${identity.repository}@${identity.commit}\n`,
      );
    } else {
      throw new Error(
        "usage: bun scripts/check-takosumi-composition-source.ts [--print-commit]",
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
