import type {
  GitCompareFileSummary,
  GitCompareResponse,
  GitListCommitsResponse,
  GitMergePullRequestRequest,
  GitMergePullRequestResponse,
  GitPullRequestDiffFile,
  GitPullRequestDiffHunk,
  GitPullRequestDiffResponse,
  GitReadBlobResponse,
  GitReadCommitResponse,
  GitReadTreeResponse,
  GitSourceSnapshotFile,
  GitSourceSnapshotResponse,
} from "takos-git-contract";
import {
  configuredRepositoryPath,
  devInMemoryMetadataEnabled,
  isLiteralObjectId,
  isSafeRefInput,
  notImplemented,
  readConfiguredGitRawObject,
  readConfiguredGitRefs,
  readConfiguredPullRequest,
  runGit,
  updateConfiguredPullRequest,
  verifyConfiguredGitCommit,
} from "./git.ts";
import { isSafeTreePath } from "./validation.ts";

const DEFAULT_MAX_BLOB_BYTES = 1024 * 1024;
const DEFAULT_MAX_SOURCE_SNAPSHOT_FILES = 5000;
const DEFAULT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES = 256 * 1024;

export const textDecoder = new TextDecoder();
// Strict decoder used to probe whether a NUL-free blob is genuinely valid
// UTF-8. Unlike the non-fatal `textDecoder` above (which replaces invalid
// sequences with U+FFFD), this throws on malformed input so we can route
// non-UTF-8 content to base64 instead of silently corrupting it.
const utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });

export interface StoredGitRepositoryView {
  id: string;
  defaultBranch: string;
}

function envIntegerOr(
  name: string,
  fallback: number,
  minimum: number,
): number {
  const configured = Number(Deno.env.get(name));
  if (Number.isInteger(configured) && configured >= minimum) return configured;
  return fallback;
}

export function maxGitBlobBytes(): number {
  return envIntegerOr("TAKOS_GIT_MAX_BLOB_BYTES", DEFAULT_MAX_BLOB_BYTES, 1);
}

export function configuredSourceSnapshotFileLimit(): number {
  return envIntegerOr(
    "TAKOS_GIT_MAX_SOURCE_SNAPSHOT_FILES",
    DEFAULT_MAX_SOURCE_SNAPSHOT_FILES,
    0,
  );
}

export function configuredSourceSnapshotManifestByteLimit(): number {
  return envIntegerOr(
    "TAKOS_GIT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES",
    DEFAULT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES,
    0,
  );
}

export function gitObjectTooLarge(objectId: string, size: number) {
  return {
    error: "git object exceeds configured response size limit",
    code: "git_object_too_large",
    objectId,
    size,
    maxBytes: maxGitBlobBytes(),
  };
}

export function invalidTreePath(repositoryId: string) {
  return {
    ok: false as const,
    status: 400 as const,
    body: {
      error: "path must be a safe repository-relative path",
      code: "invalid_git_tree_path",
      repositoryId,
    },
  };
}

export function canonicalRefName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("refs/")) return trimmed;
  return `refs/heads/${trimmed}`;
}

function refResolutionCandidatesForBranch(
  defaultBranch: string,
  sourceRef: string,
): string[] {
  const trimmed = sourceRef.trim();
  const candidates = new Set<string>([trimmed]);
  if (!trimmed.startsWith("refs/")) {
    candidates.add(`refs/heads/${trimmed}`);
    candidates.add(`refs/tags/${trimmed}`);
  }
  if (trimmed === defaultBranch) candidates.add(`refs/heads/${defaultBranch}`);
  return [...candidates].filter(isSafeRefInput);
}

export async function resolveConfiguredGitRef(
  repositoryId: string,
  defaultBranch: string,
  sourceRef: string,
): Promise<
  | { ok: true; resolved?: { name: string; target: string } }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const refs = await readConfiguredGitRefs(repositoryId);
  if (!refs.ok) return refs;
  const candidates = refResolutionCandidatesForBranch(defaultBranch, sourceRef);
  for (const candidate of candidates) {
    const ref = refs.refs.find((entry) => entry.name === candidate);
    if (!ref) continue;
    const commit = await runGit([
      "--git-dir",
      refs.repositoryPath,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref.name}^{commit}`,
    ]);
    if (commit.success) {
      return {
        ok: true,
        resolved: {
          name: ref.name,
          target: textDecoder.decode(commit.stdout).trim(),
        },
      };
    }
    return { ok: true, resolved: { name: ref.name, target: ref.target } };
  }
  return { ok: true };
}

export async function verifyLiteralSourceCommit(
  repositoryId: string,
  sourceRef: string,
): Promise<
  | { ok: true; commit: string }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const verified = await verifyConfiguredGitCommit(repositoryId, sourceRef);
  if (verified.ok) return verified;
  if (verified.status === 501 && devInMemoryMetadataEnabled()) {
    return { ok: true, commit: sourceRef };
  }
  return verified;
}

export async function resolveRepositorySourceCommit(
  repository: StoredGitRepositoryView,
  sourceRef: string,
): Promise<
  | { ok: true; commit: string }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  if (isLiteralObjectId(sourceRef)) {
    const verified = await verifyLiteralSourceCommit(repository.id, sourceRef);
    if (!verified.ok) return verified;
    return { ok: true, commit: verified.commit };
  }
  const resolved = await resolveConfiguredGitRef(
    repository.id,
    repository.defaultBranch,
    sourceRef,
  );
  if (!resolved.ok) return resolved;
  if (!resolved.resolved) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "git ref could not be resolved",
        code: "git_ref_not_found",
        repositoryId: repository.id,
        sourceRef,
      },
    };
  }
  return { ok: true, commit: resolved.resolved.target };
}

export async function buildTreeResponse(input: {
  repository: StoredGitRepositoryView;
  sourceRef: string;
  path: string;
}): Promise<
  | { ok: true; response: GitReadTreeResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
    };
    status: 400 | 404 | 409 | 413 | 422 | 501;
  }
> {
  const resolved = await resolveRepositorySourceCommit(
    input.repository,
    input.sourceRef,
  );
  if (!resolved.ok) return resolved;
  if (!isSafeTreePath(input.path)) {
    return invalidTreePath(input.repository.id);
  }
  const repositoryPath = configuredRepositoryPath(input.repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const treeish = `${resolved.commit}:${input.path === "." ? "" : input.path}`;
  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "ls-tree",
    "-z",
    "--long",
    treeish,
  ]);
  if (!output.success) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "tree path not found",
        code: "git_tree_path_not_found",
        repositoryId: input.repository.id,
      },
    };
  }
  const entries = textDecoder.decode(output.stdout).split("\0").filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const metadata = entry.slice(0, tab).trim().split(/\s+/);
      const path = entry.slice(tab + 1);
      return {
        path: input.path === "." ? path : `${input.path}/${path}`,
        name: path.split("/").pop() ?? path,
        mode: metadata[0] ?? "",
        type: metadata[1] ?? "",
        objectId: metadata[2] ?? "",
        size: metadata[3] === "-" ? undefined : Number(metadata[3]) || 0,
      };
    });
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      sourceRef: input.sourceRef,
      resolvedCommit: resolved.commit,
      path: input.path,
      entries,
    },
  };
}

export async function buildBlobResponse(input: {
  repository: StoredGitRepositoryView;
  sourceRef: string;
  path: string;
}): Promise<
  | { ok: true; response: GitReadBlobResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 413 | 422 | 501;
  }
> {
  const resolved = await resolveRepositorySourceCommit(
    input.repository,
    input.sourceRef,
  );
  if (!resolved.ok) return resolved;
  if (!isSafeTreePath(input.path) || input.path === ".") {
    return invalidTreePath(input.repository.id);
  }
  const repositoryPath = configuredRepositoryPath(input.repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const objectId = await runGit([
    "--git-dir",
    repositoryPath,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${resolved.commit}:${input.path}`,
  ]);
  if (!objectId.success) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "blob path not found",
        code: "git_blob_path_not_found",
        repositoryId: input.repository.id,
      },
    };
  }
  const object = await readConfiguredGitRawObject(
    input.repository.id,
    textDecoder.decode(objectId.stdout).trim(),
    maxGitBlobBytes(),
  );
  if (!object.ok) return object;
  if (object.type !== "blob") {
    return {
      ok: false,
      status: 422,
      body: {
        error: "path does not resolve to a blob",
        code: "git_path_not_blob",
        repositoryId: input.repository.id,
        objectId: object.objectId,
      },
    };
  }
  if (object.size > maxGitBlobBytes()) {
    return {
      ok: false,
      status: 413,
      body: gitObjectTooLarge(object.objectId, object.size),
    };
  }
  // Classify text vs binary. The NUL-byte test is a cheap pre-filter; for
  // NUL-free content we additionally attempt a strict (fatal) UTF-8 decode
  // and fall back to base64 if it throws, so non-UTF-8 blobs are not silently
  // corrupted with U+FFFD replacement characters.
  let content: string;
  let encoding: "utf-8" | "base64";
  if (object.content.some((byte) => byte === 0)) {
    encoding = "base64";
    content = base64Encode(object.content);
  } else {
    try {
      content = utf8FatalDecoder.decode(object.content);
      encoding = "utf-8";
    } catch {
      encoding = "base64";
      content = base64Encode(object.content);
    }
  }
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      sourceRef: input.sourceRef,
      resolvedCommit: resolved.commit,
      path: input.path,
      objectId: object.objectId,
      size: object.size,
      encoding,
      content,
    },
  };
}

export async function buildCommitResponse(input: {
  repository: StoredGitRepositoryView;
  sourceRef: string;
}): Promise<
  | { ok: true; response: GitReadCommitResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const commits = await buildCommitsResponse({
    repository: input.repository,
    sourceRef: input.sourceRef,
    limit: 1,
  });
  if (!commits.ok) return commits;
  const commit = commits.response.commits[0];
  if (!commit) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "commit not found",
        code: "git_commit_not_found",
        repositoryId: input.repository.id,
        sourceRef: input.sourceRef,
      },
    };
  }
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      sourceRef: input.sourceRef,
      resolvedCommit: commits.response.resolvedCommit,
      commit,
    },
  };
}

export async function buildCompareResponse(input: {
  repository: StoredGitRepositoryView;
  baseRef: string;
  headRef: string;
}): Promise<
  | { ok: true; response: GitCompareResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const base = await resolveRepositorySourceCommit(
    input.repository,
    input.baseRef,
  );
  if (!base.ok) return base;
  const head = await resolveRepositorySourceCommit(
    input.repository,
    input.headRef,
  );
  if (!head.ok) return head;
  const repositoryPath = configuredRepositoryPath(input.repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const counts = await runGit([
    "--git-dir",
    repositoryPath,
    "rev-list",
    "--left-right",
    "--count",
    `${base.commit}...${head.commit}`,
  ]);
  if (!counts.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "failed to compare commits",
        code: "git_compare_unreadable",
        repositoryId: input.repository.id,
      },
    };
  }
  const [behindText, aheadText] = textDecoder.decode(counts.stdout).trim()
    .split(/\s+/);
  const mergeBase = await runGit([
    "--git-dir",
    repositoryPath,
    "merge-base",
    base.commit,
    head.commit,
  ]);
  const filesOutput = await runGit([
    "--git-dir",
    repositoryPath,
    "diff",
    "--name-status",
    "-z",
    `${base.commit}..${head.commit}`,
  ]);
  if (!filesOutput.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "failed to compare files",
        code: "git_compare_files_unreadable",
        repositoryId: input.repository.id,
      },
    };
  }
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      baseRef: input.baseRef,
      headRef: input.headRef,
      baseCommit: base.commit,
      headCommit: head.commit,
      mergeBase: mergeBase.success
        ? textDecoder.decode(mergeBase.stdout).trim()
        : undefined,
      aheadBy: Number(aheadText) || 0,
      behindBy: Number(behindText) || 0,
      files: parseNameStatus(filesOutput.stdout),
    },
  };
}

export async function buildPullRequestDiffResponse(input: {
  repository: StoredGitRepositoryView;
  pullRequestNumber: number;
  baseRef: string;
  headRef: string;
}): Promise<
  | { ok: true; response: GitPullRequestDiffResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const compare = await buildCompareResponse({
    repository: input.repository,
    baseRef: input.baseRef,
    headRef: input.headRef,
  });
  if (!compare.ok) return compare;
  const repositoryPath = configuredRepositoryPath(input.repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const diffOutput = await runGit([
    "--git-dir",
    repositoryPath,
    "diff",
    "--unified=3",
    "--no-color",
    "--no-ext-diff",
    `${compare.response.baseCommit}..${compare.response.headCommit}`,
  ]);
  if (!diffOutput.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "failed to build pull request diff",
        code: "git_pull_request_diff_unreadable",
        repositoryId: input.repository.id,
      },
    };
  }
  const files = parsePullRequestUnifiedDiff(
    textDecoder.decode(diffOutput.stdout),
    compare.response.files,
  );
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      pullRequestNumber: input.pullRequestNumber,
      baseRef: input.baseRef,
      headRef: input.headRef,
      baseCommit: compare.response.baseCommit,
      headCommit: compare.response.headCommit,
      files,
      stats: {
        totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
        totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
        filesChanged: files.length,
      },
    },
  };
}

export async function buildCommitsResponse(input: {
  repository: StoredGitRepositoryView;
  sourceRef: string;
  path?: string;
  limit: number;
  offset?: number;
}): Promise<
  | { ok: true; response: GitListCommitsResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const resolved = await resolveRepositorySourceCommit(
    input.repository,
    input.sourceRef,
  );
  if (!resolved.ok) return resolved;
  if (input.path !== undefined && !isSafeTreePath(input.path)) {
    return invalidTreePath(input.repository.id);
  }
  const repositoryPath = configuredRepositoryPath(input.repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "log",
    `-${input.limit}`,
    ...(input.offset ? [`--skip=${input.offset}`] : []),
    "--format=%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1e",
    resolved.commit,
    ...(input.path ? ["--", input.path] : []),
  ]);
  if (!output.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "failed to list commits",
        code: "git_commits_unreadable",
        repositoryId: input.repository.id,
      },
    };
  }
  const commits = textDecoder.decode(output.stdout).split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [
        sha,
        tree,
        parents,
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        message,
      ] = entry.split("\x1f");
      return {
        sha,
        tree,
        parents: parents ? parents.split(/\s+/).filter(Boolean) : [],
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerEmail,
        committerDate,
        message: message ?? "",
      };
    });
  return {
    ok: true,
    response: {
      repositoryId: input.repository.id,
      sourceRef: input.sourceRef,
      resolvedCommit: resolved.commit,
      commits,
    },
  };
}

export async function buildSourceSnapshot(input: {
  repositoryId: string;
  defaultBranch: string;
  sourceRef: string;
  path?: string;
  manifestPath?: string;
}): Promise<
  | { ok: true; response: GitSourceSnapshotResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      sourceRef?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const resolved = isLiteralObjectId(input.sourceRef)
    ? await verifyLiteralSourceCommit(input.repositoryId, input.sourceRef)
    : await resolveConfiguredGitRef(
      input.repositoryId,
      input.defaultBranch,
      input.sourceRef,
    );
  if (!resolved.ok) return resolved;

  const commitSha = "commit" in resolved
    ? resolved.commit
    : resolved.resolved?.target;
  if (!commitSha) {
    return {
      ok: false,
      status: 422,
      body: {
        error:
          "real ref resolution is not implemented/configured for takos-git",
        code: "git_ref_resolution_not_configured",
        repositoryId: input.repositoryId,
        sourceRef: input.sourceRef,
      },
    };
  }

  const repositoryPath = configuredRepositoryPath(input.repositoryId);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const snapshotPath = input.path?.trim() || ".";
  const manifestPath = input.manifestPath?.trim() || "takos.json";
  if (!isSafeTreePath(snapshotPath) || !isSafeTreePath(manifestPath)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "path and manifestPath must be safe repository-relative paths",
        code: "invalid_git_tree_path",
        repositoryId: input.repositoryId,
      },
    };
  }

  const filesResult = await readTreeFiles(
    repositoryPath,
    commitSha,
    snapshotPath,
    configuredSourceSnapshotFileLimit(),
  );
  if (!filesResult.ok) {
    const tooLarge =
      filesResult.code === "git_source_snapshot_file_limit_exceeded";
    return {
      ok: false,
      status: 422,
      body: {
        error: tooLarge
          ? "source snapshot exceeds configured file limit"
          : "failed to read source tree",
        code: filesResult.code,
        repositoryId: input.repositoryId,
        sourceRef: input.sourceRef,
      },
    };
  }

  const manifestFile = filesResult.files.find((file) =>
    file.path === manifestPath
  );
  const maxManifestBytes = configuredSourceSnapshotManifestByteLimit();
  if (manifestFile && manifestFile.size > maxManifestBytes) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "source snapshot manifest exceeds configured byte limit",
        code: "git_source_snapshot_manifest_too_large",
        repositoryId: input.repositoryId,
        sourceRef: input.sourceRef,
        objectId: manifestFile.objectId,
      },
    };
  }
  const manifest = manifestFile
    ? await readManifest(repositoryPath, manifestFile)
    : undefined;
  const digest = await snapshotDigest({
    repositoryId: input.repositoryId,
    sourceRef: input.sourceRef,
    commitSha,
    path: snapshotPath,
    manifestPath,
    files: filesResult.files,
    manifestDigest: manifest?.digest,
  });
  return {
    ok: true,
    response: {
      kind: "git",
      repositoryId: input.repositoryId,
      sourceRef: input.sourceRef,
      resolvedRef: "resolved" in resolved ? resolved.resolved?.name : undefined,
      commitSha,
      digest,
      path: snapshotPath,
      manifestPath,
      manifest,
      files: filesResult.files,
      capturedAt: new Date().toISOString(),
    },
  };
}

async function readTreeFiles(
  repositoryPath: string,
  commitSha: string,
  snapshotPath: string,
  maxFiles: number,
): Promise<
  | { ok: true; files: GitSourceSnapshotFile[] }
  | { ok: false; code: "git_source_tree_unreadable" }
  | {
    ok: false;
    code: "git_source_snapshot_file_limit_exceeded";
    maxFiles: number;
  }
> {
  const args = [
    "--git-dir",
    repositoryPath,
    "ls-tree",
    "-r",
    "-z",
    "--long",
    commitSha,
    "--",
    ...(snapshotPath === "." ? [] : [snapshotPath]),
  ];
  const output = await runGit(args);
  if (!output.success) return { ok: false, code: "git_source_tree_unreadable" };
  const entries = textDecoder.decode(output.stdout).split("\0").filter(Boolean);
  if (entries.length > maxFiles) {
    return {
      ok: false,
      code: "git_source_snapshot_file_limit_exceeded",
      maxFiles,
    };
  }
  const files: GitSourceSnapshotFile[] = [];
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const metadata = entry.slice(0, tab).trim().split(/\s+/);
    if (metadata.length < 4) continue;
    const [mode, type, objectId, sizeText] = metadata;
    files.push({
      mode,
      type,
      objectId,
      size: Number(sizeText) || 0,
      path: entry.slice(tab + 1),
    });
  }
  return { ok: true, files };
}

async function readManifest(
  repositoryPath: string,
  file: GitSourceSnapshotFile,
): Promise<GitSourceSnapshotResponse["manifest"]> {
  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "cat-file",
    "-p",
    file.objectId,
  ]);
  if (!output.success) return undefined;
  const content = textDecoder.decode(output.stdout);
  return {
    path: file.path,
    objectId: file.objectId,
    digest: await sha256Hex(content),
    content,
  };
}

async function snapshotDigest(input: {
  repositoryId: string;
  sourceRef: string;
  commitSha: string;
  path: string;
  manifestPath: string;
  manifestDigest?: string;
  files: GitSourceSnapshotFile[];
}): Promise<string> {
  return await sha256Hex(JSON.stringify({
    ...input,
    files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function parseNameStatus(output: Uint8Array): GitCompareFileSummary[] {
  const tokens = textDecoder.decode(output).split("\0").filter(Boolean);
  const files: GitCompareFileSummary[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const statusToken = tokens[index] ?? "";
    const status = nameStatus(statusToken);
    if (status === "renamed" || status === "copied") {
      const oldPath = tokens[++index];
      const path = tokens[++index];
      if (path) files.push({ path, oldPath, status });
      continue;
    }
    const path = tokens[++index];
    if (path) files.push({ path, status });
  }
  return files;
}

function parsePullRequestUnifiedDiff(
  diffText: string,
  summaries: readonly GitCompareFileSummary[],
): GitPullRequestDiffFile[] {
  const files = summaries.map((summary) => ({
    ...summary,
    additions: 0,
    deletions: 0,
    hunks: [] as GitPullRequestDiffHunk[],
  }));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  let currentFile: GitPullRequestDiffFile | undefined;
  let currentHunk: GitPullRequestDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = parseDiffGitNewPath(line);
      currentFile = path ? filesByPath.get(path) : undefined;
      currentHunk = undefined;
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith("@@ ")) {
      const header = parseUnifiedHunkHeader(line);
      if (!header) {
        currentHunk = undefined;
        continue;
      }
      oldLine = header.oldStart;
      newLine = header.newStart;
      currentHunk = {
        oldStart: header.oldStart,
        oldLines: header.oldLines,
        newStart: header.newStart,
        newLines: header.newLines,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk || line.length === 0 || line.startsWith("\\")) continue;
    const marker = line[0];
    const content = line.slice(1);
    if (marker === " ") {
      currentHunk.lines.push({
        type: "context",
        content,
        oldLine,
        newLine,
      });
      oldLine++;
      newLine++;
    } else if (marker === "-") {
      currentFile.deletions++;
      currentHunk.lines.push({ type: "deletion", content, oldLine });
      oldLine++;
    } else if (marker === "+") {
      currentFile.additions++;
      currentHunk.lines.push({ type: "addition", content, newLine });
      newLine++;
    }
  }

  return files;
}

function parseDiffGitNewPath(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match?.[2];
}

function parseUnifiedHunkHeader(line: string):
  | {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
  }
  | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return undefined;
  return {
    oldStart: Number(match[1]),
    oldLines: match[2] ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newLines: match[4] ? Number(match[4]) : 1,
  };
}

function nameStatus(status: string): GitCompareFileSummary["status"] {
  const code = status[0];
  if (code === "A") return "added";
  if (code === "M") return "modified";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  return status;
}

export async function mergePullRequestFastForward(
  repository: StoredGitRepositoryView,
  number: number,
  request: Partial<GitMergePullRequestRequest>,
): Promise<
  | { ok: true; response: GitMergePullRequestResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
      pullRequestNumber?: number;
      sourceRef?: string;
      objectId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const pullRequestResult = await readConfiguredPullRequest(
    repository.id,
    number,
  );
  if (!pullRequestResult.ok) return pullRequestResult;
  const pullRequest = pullRequestResult.pullRequest;
  if (pullRequest.status !== "open") {
    return {
      ok: false,
      status: 409,
      body: {
        error: "pull request is not open",
        code: "git_pull_request_not_open",
        repositoryId: repository.id,
        pullRequestNumber: number,
      },
    };
  }
  const repositoryPath = configuredRepositoryPath(repository.id);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  const base = await resolveRepositorySourceCommit(
    repository,
    pullRequest.baseBranch,
  );
  if (!base.ok) return base;
  const head = await resolveRepositorySourceCommit(
    repository,
    pullRequest.headBranch,
  );
  if (!head.ok) return head;
  if (request.expectedHead && request.expectedHead !== head.commit) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "pull request head changed",
        code: "git_pull_request_head_changed",
        repositoryId: repository.id,
        pullRequestNumber: number,
        objectId: head.commit,
      },
    };
  }
  const ancestor = await runGit([
    "--git-dir",
    repositoryPath,
    "merge-base",
    "--is-ancestor",
    base.commit,
    head.commit,
  ]);
  if (!ancestor.success) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "pull request is not fast-forward mergeable",
        code: "git_pull_request_not_fast_forward",
        repositoryId: repository.id,
        pullRequestNumber: number,
      },
    };
  }
  const baseRef = canonicalRefName(pullRequest.baseBranch);
  const updated = await runGit([
    "--git-dir",
    repositoryPath,
    "update-ref",
    baseRef,
    head.commit,
    base.commit,
  ]);
  if (!updated.success) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "failed to update base branch",
        code: "git_pull_request_merge_failed",
        repositoryId: repository.id,
        pullRequestNumber: number,
      },
    };
  }
  const mergedAt = new Date().toISOString();
  const merged = await updateConfiguredPullRequest(repository.id, number, {
    status: "merged",
  });
  if (!merged.ok) return merged;
  return {
    ok: true,
    response: {
      merged: true,
      repositoryId: repository.id,
      pullRequestNumber: number,
      method: "ff-only",
      baseBranch: pullRequest.baseBranch,
      headBranch: pullRequest.headBranch,
      baseCommit: base.commit,
      headCommit: head.commit,
      mergedAt: merged.pullRequest.mergedAt ?? mergedAt,
      pullRequest: merged.pullRequest,
    },
  };
}
