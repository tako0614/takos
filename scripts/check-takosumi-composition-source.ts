#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const PIN_KIND = "takos.takosumi-composition-source@v1" as const;
const REPOSITORY = "tako0614/takosumi" as const;
const PIN_FILENAME = "takosumi-composition-source.json";
const COMMIT = /^[0-9a-f]{40}$/u;

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
