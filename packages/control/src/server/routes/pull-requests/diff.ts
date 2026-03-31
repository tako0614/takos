import * as gitStore from '../../../application/services/git-smart/index.ts';
import { decodeBlobContent } from '../../../shared/utils/unified-diff.ts';
import { diffLinesLcs } from '../../../shared/utils/lcs-diff.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { toGitBucket, type GitBucket } from '../../../shared/utils/git-bucket.ts';
import { GIT_DIFF_MAX_FILE_BYTES, GIT_DIFF_MAX_LINES, GIT_DIFF_MAX_FILES } from '../../../shared/config/limits.ts';

export type FileStatus = 'added' | 'modified' | 'deleted';

export type RepoDiffFile = {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
};

type DiffLine = {
  type: 'context' | 'addition' | 'deletion';
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

function parseFlattenLimitError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('Tree flatten depth limit exceeded')
    || message.includes('Tree flatten entry limit exceeded')
  ) {
    return message;
  }
  return null;
}

function determineFileStatus(baseOid: string | null, headOid: string | null): FileStatus | null {
  if (!baseOid && headOid) return 'added';
  if (baseOid && !headOid) return 'deleted';
  if (baseOid && headOid && baseOid !== headOid) return 'modified';
  return null;
}

function computeDiffStats(files: RepoDiffFile[]): RepoDiffPayload['stats'] {
  return {
    total_additions: files.reduce((sum, file) => sum + file.additions, 0),
    total_deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files_changed: files.length,
  };
}

function buildDiffLines(
  ops: Array<{ type: 'equal' | 'insert' | 'delete'; line: string }>,
): { lines: DiffLine[]; additions: number; deletions: number } {
  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  for (const op of ops) {
    if (op.type === 'equal') {
      lines.push({ type: 'context', content: op.line, old_line: oldLineNo, new_line: newLineNo });
      oldLineNo++;
      newLineNo++;
    } else if (op.type === 'delete') {
      deletions++;
      lines.push({ type: 'deletion', content: op.line, old_line: oldLineNo });
      oldLineNo++;
    } else {
      additions++;
      lines.push({ type: 'addition', content: op.line, new_line: newLineNo });
      newLineNo++;
    }
  }

  return { lines, additions, deletions };
}

async function loadBlobText(
  bucket: GitBucket,
  oid: string | null,
  maxBytes: number,
): Promise<string | null> {
  if (!oid) return '';
  const blob = await gitStore.getBlob(bucket, oid);
  if (!blob) return '';
  if (blob.length > maxBytes) return null;
  const decoded = decodeBlobContent(blob);
  if (decoded.isBinary) return null;
  return decoded.text;
}

async function computeFileDiffWithHunks(
  bucket: GitBucket,
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

  const splitLines = (text: string): string[] => (text.length === 0 ? [] : text.split('\n'));
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldLines.length > maxLines || newLines.length > maxLines) {
    return { path, status, additions: 0, deletions: 0, hunks: [] };
  }

  const ops = diffLinesLcs(oldLines, newLines);
  const { lines, additions, deletions } = buildDiffLines(ops);

  const hunks: DiffHunk[] = lines.length > 0
    ? [{ old_start: 1, old_lines: oldLines.length, new_start: 1, new_lines: newLines.length, lines }]
    : [];

  return { path, status, additions, deletions, hunks };
}

async function computeDetailedFileDiffs(
  bucket: GitBucket,
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

  const files: DetailedDiffFile[] = [];
  let truncated = false;

  for (const path of paths) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }

    const baseOid = baseMap.get(path) || null;
    const headOid = headMap.get(path) || null;
    const status = determineFileStatus(baseOid, headOid);
    if (!status) continue;

    files.push(await computeFileDiffWithHunks(bucket, path, status, baseOid, headOid, MAX_FILE_BYTES, MAX_LINES));
  }

  return { files, truncated };
}

function computeSummaryFileDiffs(
  baseFiles: TreeFileEntry[],
  headFiles: TreeFileEntry[],
): RepoDiffFile[] {
  const baseMap = new Map(baseFiles.map((file) => [file.path, file.sha]));
  const headMap = new Map(headFiles.map((file) => [file.path, file.sha]));
  const files: RepoDiffFile[] = [];

  for (const [path, oid] of headMap) {
    const baseOid = baseMap.get(path);
    if (!baseOid) {
      files.push({ path, status: 'added', additions: 1, deletions: 0 });
    } else if (baseOid !== oid) {
      files.push({ path, status: 'modified', additions: 1, deletions: 1 });
    }
  }

  for (const [path] of baseMap) {
    if (!headMap.has(path)) {
      files.push({ path, status: 'deleted', additions: 0, deletions: 1 });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function resolveTreeFiles(
  bucket: GitBucket,
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  ref: string,
): Promise<TreeFileEntry[] | null> {
  const sha = await gitStore.resolveRef(env.DB, repoId, ref);
  if (!sha) return null;
  const commit = await gitStore.getCommitData(bucket, sha);
  if (!commit) return null;
  return gitStore.flattenTree(bucket, commit.tree);
}

export async function buildRepoDiffPayload(
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  baseRef: string,
  headRef: string,
): Promise<RepoDiffPayload | null> {
  const bucketBinding = env.GIT_OBJECTS;
  if (!bucketBinding) return null;
  const bucket = toGitBucket(bucketBinding);

  try {
    const [baseFiles, headFiles] = await Promise.all([
      resolveTreeFiles(bucket, env, repoId, baseRef),
      resolveTreeFiles(bucket, env, repoId, headRef),
    ]);
    if (!baseFiles || !headFiles) return null;

    const files = computeSummaryFileDiffs(baseFiles, headFiles);
    return { base: baseRef, head: headRef, files, stats: computeDiffStats(files) };
  } catch (error) {
    if (parseFlattenLimitError(error)) return null;
    throw error;
  }
}

export async function buildDetailedRepoDiffPayload(
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  baseRef: string,
  headRef: string,
): Promise<
  | { success: true; payload: { base: string; head: string; files: DetailedDiffFile[]; stats: RepoDiffPayload['stats']; truncated: boolean } }
  | { success: false; status: 404 | 422 | 500; body: { error: string; message?: string } }
> {
  const bucketBinding = env.GIT_OBJECTS;
  if (!bucketBinding) {
    return { success: false, status: 500, body: { error: 'Git storage not configured' } };
  }
  const bucket = toGitBucket(bucketBinding);

  const baseSha = await gitStore.resolveRef(env.DB, repoId, baseRef);
  const headSha = await gitStore.resolveRef(env.DB, repoId, headRef);
  if (!baseSha || !headSha) {
    return { success: false, status: 404, body: { error: 'Ref not found' } };
  }

  const baseCommit = await gitStore.getCommitData(bucket, baseSha);
  const headCommit = await gitStore.getCommitData(bucket, headSha);
  if (!baseCommit || !headCommit) {
    return { success: false, status: 404, body: { error: 'Commit not found' } };
  }

  let baseFiles: TreeFileEntry[];
  let headFiles: TreeFileEntry[];
  try {
    baseFiles = await gitStore.flattenTree(bucket, baseCommit.tree);
    headFiles = await gitStore.flattenTree(bucket, headCommit.tree);
  } catch (error) {
    const flattenMessage = parseFlattenLimitError(error);
    if (flattenMessage) {
      return {
        success: false,
        status: 422,
        body: {
          error: 'Pull request diff exceeds flatten limits',
          message: flattenMessage,
        },
      };
    }
    throw error;
  }

  const { files, truncated } = await computeDetailedFileDiffs(bucket, baseFiles, headFiles);
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
