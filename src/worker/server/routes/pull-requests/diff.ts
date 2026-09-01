import * as takosGit from "../../../application/services/takos-git/index.ts";
import { decodeBlobContent } from "../../../shared/utils/unified-diff.ts";
import { diffLinesLcs } from "../../../shared/utils/lcs-diff.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import {
  GIT_DIFF_MAX_FILE_BYTES,
  GIT_DIFF_MAX_FILES,
  GIT_DIFF_MAX_LINES,
} from "../../../shared/config/limits.ts";

export type FileStatus = "added" | "modified" | "deleted";

export type RepoDiffFile = {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
};

type DiffLine = {
  type: "context" | "addition" | "deletion";
  content: string;
  old_line?: number;
  new_line?: number;
};

type DiffHunk = {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
};

export type DetailedDiffFile = RepoDiffFile & {
  hunks: DiffHunk[];
};

export type RepoDiffPayload = {
  base: string;
  head: string;
  files: RepoDiffFile[];
  stats: {
    total_additions: number;
    total_deletions: number;
    files_changed: number;
  };
};

type TreeFileEntry = { path: string; sha: string; mode: string };

type CommonErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

const DIFF_FILE_CONCURRENCY = 8;

function parseFlattenLimitError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Tree flatten depth limit exceeded") ||
    message.includes("Tree flatten entry limit exceeded")
  ) {
    return message;
  }
  return null;
}

function determineFileStatus(
  baseOid: string | null,
  headOid: string | null,
): FileStatus | null {
  if (!baseOid && headOid) return "added";
  if (baseOid && !headOid) return "deleted";
  if (baseOid && headOid && baseOid !== headOid) return "modified";
  return null;
}

function computeDiffStats(files: RepoDiffFile[]): RepoDiffPayload["stats"] {
  return {
    total_additions: files.reduce((sum, file) => sum + file.additions, 0),
    total_deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files_changed: files.length,
  };
}

function buildDiffLines(
  ops: Array<{ type: "equal" | "insert" | "delete"; line: string }>,
): { lines: DiffLine[]; additions: number; deletions: number } {
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      lines.push({
        type: "context",
        content: op.line,
        old_line: oldLineNo,
        new_line: newLineNo,
      });
      oldLineNo++;
      newLineNo++;
    } else if (op.type === "delete") {
      deletions++;
      lines.push({ type: "deletion", content: op.line, old_line: oldLineNo });
      oldLineNo++;
    } else {
      additions++;
      lines.push({ type: "addition", content: op.line, new_line: newLineNo });
      newLineNo++;
    }
  }

  return { lines, additions, deletions };
}

async function loadBlobText(
  bucket: takosGit.GitBucket,
  oid: string | null,
  maxBytes: number,
): Promise<string | null> {
  if (!oid) return "";
  const blob = await takosGit.getBlob(bucket, oid);
  if (!blob) return "";
  if (blob.length > maxBytes) return null;
  const decoded = decodeBlobContent(blob);
  if (decoded.isBinary) return null;
  return decoded.text;
}

async function computeFileDiffWithHunks(
  bucket: takosGit.GitBucket,
  path: string,
  status: FileStatus,
  baseOid: string | null,
  headOid: string | null,
  maxFileBytes: number,
  maxLines: number,
): Promise<DetailedDiffFile> {
  const [oldText, newText] = await Promise.all([
    loadBlobText(bucket, baseOid, maxFileBytes),
    loadBlobText(bucket, headOid, maxFileBytes),
  ]);

  if (oldText === null || newText === null) {
    return { path, status, additions: 0, deletions: 0, hunks: [] };
  }

  const splitLines = (
    text: string,
  ): string[] => (text.length === 0 ? [] : text.split("\n"));
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length > maxLines || newLines.length > maxLines) {
    return { path, status, additions: 0, deletions: 0, hunks: [] };
  }

  const ops = diffLinesLcs(oldLines, newLines);
  const { lines, additions, deletions } = buildDiffLines(ops);

  const hunks: DiffHunk[] = lines.length > 0
    ? [{
      old_start: 1,
      old_lines: oldLines.length,
      new_start: 1,
      new_lines: newLines.length,
      lines,
    }]
    : [];

  return { path, status, additions, deletions, hunks };
}

async function computeDetailedFileDiffs(
  bucket: takosGit.GitBucket,
  baseFiles: TreeFileEntry[],
  headFiles: TreeFileEntry[],
): Promise<{ files: DetailedDiffFile[]; truncated: boolean }> {
  const MAX_FILES = GIT_DIFF_MAX_FILES;
  const MAX_FILE_BYTES = GIT_DIFF_MAX_FILE_BYTES;
  const MAX_LINES = GIT_DIFF_MAX_LINES;

  const baseMap = new Map(baseFiles.map((file) => [file.path, file.sha]));
  const headMap = new Map(headFiles.map((file) => [file.path, file.sha]));
  const allPaths = new Set<string>([...baseMap.keys(), ...headMap.keys()]);
  const paths = Array.from(allPaths).sort((a, b) => a.localeCompare(b));

  const candidates: Array<{
    path: string;
    status: FileStatus;
    baseOid: string | null;
    headOid: string | null;
  }> = [];
  let truncated = false;

  for (const path of paths) {
    if (candidates.length >= MAX_FILES) {
      truncated = true;
      break;
    }

    const baseOid = baseMap.get(path) || null;
    const headOid = headMap.get(path) || null;
    const status = determineFileStatus(baseOid, headOid);
    if (!status) continue;

    candidates.push({ path, status, baseOid, headOid });
  }

  const files: DetailedDiffFile[] = [];
  for (
    let waveStart = 0;
    waveStart < candidates.length;
    waveStart += DIFF_FILE_CONCURRENCY
  ) {
    const wave = candidates.slice(waveStart, waveStart + DIFF_FILE_CONCURRENCY);
    const results = wave.map(async (candidate) => {
      try {
        return {
          status: "fulfilled" as const,
          value: await computeFileDiffWithHunks(
            bucket,
            candidate.path,
            candidate.status,
            candidate.baseOid,
            candidate.headOid,
            MAX_FILE_BYTES,
            MAX_LINES,
          ),
        };
      } catch (reason) {
        return { status: "rejected" as const, reason };
      }
    });

    // Await the already-started work in path order. This preserves the serial
    // implementation's deterministic error selection without waiting for a
    // later path once the earliest failing path is known.
    for (const resultPromise of results) {
      const result = await resultPromise;
      if (result.status === "rejected") throw result.reason;
      files.push(result.value);
    }
  }

  return { files, truncated };
}

export async function computeSummaryFileDiffs(
  bucket: takosGit.GitBucket,
  baseFiles: TreeFileEntry[],
  headFiles: TreeFileEntry[],
): Promise<RepoDiffFile[]> {
  // Derive the summary from the same real LCS computation the detailed view
  // uses, then drop the hunks. This keeps additions/deletions accurate instead
  // of emitting placeholder 1/1 counts. Oversized/binary files honestly report
  // 0/0 (same cap behavior as computeFileDiffWithHunks).
  const { files } = await computeDetailedFileDiffs(bucket, baseFiles, headFiles);
  return files.map(({ path, status, additions, deletions }) => ({
    path,
    status,
    additions,
    deletions,
  }));
}

async function resolveTreeFiles(
  bucket: takosGit.GitBucket,
  env: AuthenticatedRouteEnv["Bindings"],
  repoId: string,
  ref: string,
): Promise<TreeFileEntry[] | null> {
  const sha = await takosGit.resolveRef(env.DB, repoId, ref);
  if (!sha) return null;
  const commit = await takosGit.getCommitData(bucket, sha);
  if (!commit) return null;
  return takosGit.flattenTree(bucket, commit.tree);
}

export async function buildRepoDiffPayload(
  env: AuthenticatedRouteEnv["Bindings"],
  repoId: string,
  baseRef: string,
  headRef: string,
): Promise<RepoDiffPayload | null> {
  const bucketBinding = env.GIT_OBJECTS;
  if (!bucketBinding) return null;
  const bucket = takosGit.toGitBucket(bucketBinding);

  try {
    const [baseFiles, headFiles] = await Promise.all([
      resolveTreeFiles(bucket, env, repoId, baseRef),
      resolveTreeFiles(bucket, env, repoId, headRef),
    ]);
    if (!baseFiles || !headFiles) return null;

    const files = await computeSummaryFileDiffs(bucket, baseFiles, headFiles);
    return {
      base: baseRef,
      head: headRef,
      files,
      stats: computeDiffStats(files),
    };
  } catch (error) {
    if (parseFlattenLimitError(error)) return null;
    throw error;
  }
}

export async function buildDetailedRepoDiffPayload(
  env: AuthenticatedRouteEnv["Bindings"],
  repoId: string,
  baseRef: string,
  headRef: string,
): Promise<
  | {
    success: true;
    payload: {
      base: string;
      head: string;
      files: DetailedDiffFile[];
      stats: RepoDiffPayload["stats"];
      truncated: boolean;
    };
  }
  | {
    success: false;
    status: 404 | 422 | 500;
    body: CommonErrorBody;
  }
> {
  const bucketBinding = env.GIT_OBJECTS;
  if (!bucketBinding) {
    return {
      success: false,
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Git storage not configured",
        },
      },
    };
  }
  const bucket = takosGit.toGitBucket(bucketBinding);

  const baseSha = await takosGit.resolveRef(env.DB, repoId, baseRef);
  const headSha = await takosGit.resolveRef(env.DB, repoId, headRef);
  if (!baseSha || !headSha) {
    return {
      success: false,
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Ref not found" } },
    };
  }

  const baseCommit = await takosGit.getCommitData(bucket, baseSha);
  const headCommit = await takosGit.getCommitData(bucket, headSha);
  if (!baseCommit || !headCommit) {
    return {
      success: false,
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Commit not found" } },
    };
  }

  let baseFiles: TreeFileEntry[];
  let headFiles: TreeFileEntry[];
  try {
    baseFiles = await takosGit.flattenTree(bucket, baseCommit.tree);
    headFiles = await takosGit.flattenTree(bucket, headCommit.tree);
  } catch (error) {
    const flattenMessage = parseFlattenLimitError(error);
    if (flattenMessage) {
      return {
        success: false,
        status: 422,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: flattenMessage ||
              "Pull request diff exceeds flatten limits",
          },
        },
      };
    }
    throw error;
  }

  const { files, truncated } = await computeDetailedFileDiffs(
    bucket,
    baseFiles,
    headFiles,
  );
  return {
    success: true,
    payload: {
      base: baseRef,
      head: headRef,
      files,
      stats: computeDiffStats(files),
      truncated,
    },
  };
}
