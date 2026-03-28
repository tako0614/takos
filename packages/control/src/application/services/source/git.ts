import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { getDb, files, gitCommits, gitFileChanges } from '../../../infra/db';
import { eq, and, ne, desc } from 'drizzle-orm';

// Types
export interface GitCommit {
  id: string;
  space_id: string;
  message: string;
  author_id: string;
  author_name: string;
  parent_id: string | null;
  files_changed: number;
  insertions: number;
  deletions: number;
  tree_hash: string; // Hash of file tree snapshot
  created_at: string;
}

export interface GitFileChange {
  id: string;
  commit_id: string;
  file_id: string;
  path: string;
  change_type: 'added' | 'modified' | 'deleted' | 'renamed';
  old_path: string | null;
  old_hash: string | null;
  new_hash: string | null;
  insertions: number;
  deletions: number;
}

export interface FileDiff {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldContent?: string;
  newContent?: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export class GitService {
  private d1: D1Database;
  private storage: R2Bucket;

  constructor(d1: D1Database, storage: R2Bucket) {
    this.d1 = d1;
    this.storage = storage;
  }

  async commit(
    spaceId: string,
    message: string,
    authorId: string,
    authorName: string,
    paths?: string[] // Optional: specific paths to commit
  ): Promise<GitCommit> {
    const db = getDb(this.d1);
    const timestamp = now();

    const parentCommit = await db
      .select({ id: gitCommits.id })
      .from(gitCommits)
      .where(eq(gitCommits.accountId, spaceId))
      .orderBy(desc(gitCommits.createdAt))
      .limit(1)
      .get();

    const allFiles = await db
      .select()
      .from(files)
      .where(and(eq(files.accountId, spaceId), ne(files.origin, 'system')))
      .all();

    const filteredFiles = paths
      ? allFiles.filter(f => paths.some(p => f.path.startsWith(p)))
      : allFiles;

    const treeHash = await this.calculateTreeHash(filteredFiles);
    const commitId = generateId();

    await db.insert(gitCommits).values({
      id: commitId,
      accountId: spaceId,
      message,
      authorAccountId: authorId,
      authorName,
      parentId: parentCommit?.id ?? null,
      filesChanged: filteredFiles.length,
      insertions: 0, // Calculate later
      deletions: 0, // Calculate later
      treeHash,
      createdAt: timestamp,
    });

    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const file of filteredFiles) {
      const previousChange = parentCommit
        ? await db
            .select({ newHash: gitFileChanges.newHash })
            .from(gitFileChanges)
            .where(
              and(
                eq(gitFileChanges.commitId, parentCommit.id),
                eq(gitFileChanges.path, file.path),
              ),
            )
            .get() ?? null
        : null;

      const changeType = previousChange
        ? (file.sha256 !== previousChange.newHash ? 'modified' : null)
        : 'added';

      if (changeType) {
        const { insertions, deletions } = await this.calculateDiffStats(
          spaceId,
          file.id,
          previousChange?.newHash ?? null,
          file.sha256
        );

        totalInsertions += insertions;
        totalDeletions += deletions;

        await db.insert(gitFileChanges).values({
          id: generateId(),
          commitId,
          fileId: file.id,
          path: file.path,
          changeType,
          oldPath: null,
          oldHash: previousChange?.newHash ?? null,
          newHash: file.sha256,
          insertions,
          deletions,
        });
      }
    }

    if (parentCommit) {
      const parentFiles = await db
        .select({ path: gitFileChanges.path, newHash: gitFileChanges.newHash })
        .from(gitFileChanges)
        .where(
          and(
            eq(gitFileChanges.commitId, parentCommit.id),
            ne(gitFileChanges.changeType, 'deleted'),
          ),
        )
        .all();

      const currentPaths = new Set(filteredFiles.map(f => f.path));

      const deletedFiles = parentFiles.filter(pf => !currentPaths.has(pf.path));
      if (deletedFiles.length > 0) {
        await db.insert(gitFileChanges).values(
          deletedFiles.map((pf) => ({
            id: generateId(),
            commitId,
            fileId: null,
            path: pf.path,
            changeType: 'deleted' as const,
            oldPath: pf.path,
            oldHash: pf.newHash,
            newHash: null,
            insertions: 0,
            deletions: 0, // Would need to count lines
          })),
        );
        totalDeletions += deletedFiles.length;
      }
    }

    await db
      .update(gitCommits)
      .set({
        insertions: totalInsertions,
        deletions: totalDeletions,
      })
      .where(eq(gitCommits.id, commitId));

    const commit = await db
      .select()
      .from(gitCommits)
      .where(eq(gitCommits.id, commitId))
      .get();

    if (!commit) {
      throw new Error(`Git commit ${commitId} not found after creation`);
    }
    return this.toGitCommit(commit);
  }

  async log(
    spaceId: string,
    options: {
      limit?: number;
      offset?: number;
      path?: string;
    } = {}
  ): Promise<GitCommit[]> {
    const db = getDb(this.d1);
    const { limit = 50, offset = 0, path } = options;

    if (path) {
      // Find commit IDs that have file changes matching the path
      const matchingChanges = await db
        .select({ commitId: gitFileChanges.commitId })
        .from(gitFileChanges)
        .where(eq(gitFileChanges.path, path))
        .all();
      const commitIds = [...new Set(matchingChanges.map(c => c.commitId))];

      if (commitIds.length === 0) return [];

      const allCommits = await db
        .select()
        .from(gitCommits)
        .where(eq(gitCommits.accountId, spaceId))
        .orderBy(desc(gitCommits.createdAt))
        .all();

      const commitIdSet = new Set(commitIds);
      const filtered = allCommits.filter(c => commitIdSet.has(c.id));
      return filtered.slice(offset, offset + limit).map(c => this.toGitCommit(c));
    }

    const commits = await db
      .select()
      .from(gitCommits)
      .where(eq(gitCommits.accountId, spaceId))
      .orderBy(desc(gitCommits.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    return commits.map(c => this.toGitCommit(c));
  }

  async getCommit(commitId: string): Promise<GitCommit | null> {
    const db = getDb(this.d1);
    const commit = await db
      .select()
      .from(gitCommits)
      .where(eq(gitCommits.id, commitId))
      .get();
    return commit ? this.toGitCommit(commit) : null;
  }

  async getCommitChanges(commitId: string): Promise<GitFileChange[]> {
    const db = getDb(this.d1);
    const changes = await db
      .select()
      .from(gitFileChanges)
      .where(eq(gitFileChanges.commitId, commitId))
      .all();
    return changes.map(c => this.toGitFileChange(c));
  }

  async diff(
    spaceId: string,
    _fromCommitId: string | null,
    toCommitId: string
  ): Promise<FileDiff[]> {
    const db = getDb(this.d1);
    const diffs: FileDiff[] = [];
    const changes = await this.getCommitChanges(toCommitId);

    for (const change of changes) {
      const diff: FileDiff = {
        path: change.path,
        changeType: change.change_type,
        hunks: [],
      };

      if (change.change_type !== 'deleted' && change.new_hash) {
        const file = await db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.accountId, spaceId), eq(files.path, change.path)))
          .get();

        if (file) {
          const r2Key = `spaces/${spaceId}/files/${file.id}`;
          const obj = await this.storage.get(r2Key);
          if (obj) {
            diff.newContent = await obj.text();
          }
        }
      }

      if (change.change_type !== 'added' && change.old_hash) {
        const snapshotKey = `git/${spaceId}/snapshots/${change.old_hash}`;
        const obj = await this.storage.get(snapshotKey);
        if (obj) {
          diff.oldContent = await obj.text();
        }
      }

      if (diff.oldContent || diff.newContent) {
        diff.hunks = this.generateDiffHunks(diff.oldContent || '', diff.newContent || '');
      }

      diffs.push(diff);
    }

    return diffs;
  }

  async restore(
    spaceId: string,
    commitId: string,
    path: string
  ): Promise<{ success: boolean; message: string }> {
    const db = getDb(this.d1);

    const change = await db
      .select()
      .from(gitFileChanges)
      .where(and(eq(gitFileChanges.commitId, commitId), eq(gitFileChanges.path, path)))
      .get();

    if (!change) {
      return { success: false, message: 'File not found in commit' };
    }

    if (change.changeType === 'deleted') {
      return { success: false, message: 'Cannot restore deleted file from this commit' };
    }

    const snapshotKey = `git/${spaceId}/snapshots/${change.newHash}`;
    const snapshot = await this.storage.get(snapshotKey);

    if (!snapshot) {
      return { success: false, message: 'Snapshot not found' };
    }

    const file = await db
      .select()
      .from(files)
      .where(and(eq(files.accountId, spaceId), eq(files.path, path)))
      .get();

    if (!file) {
      return { success: false, message: 'Current file not found' };
    }

    const r2Key = `spaces/${spaceId}/files/${file.id}`;
    await this.storage.put(r2Key, snapshot.body);

    await db
      .update(files)
      .set({
        sha256: change.newHash,
        updatedAt: now(),
      })
      .where(eq(files.id, file.id));

    return { success: true, message: 'File restored successfully' };
  }

  private toGitCommit(commit: {
    id: string;
    accountId: string;
    message: string;
    authorAccountId: string;
    authorName: string;
    parentId: string | null;
    filesChanged: number;
    insertions: number;
    deletions: number;
    treeHash: string;
    createdAt: string | Date;
  }): GitCommit {
    return {
      id: commit.id,
      space_id: commit.accountId,
      message: commit.message,
      author_id: commit.authorAccountId,
      author_name: commit.authorName,
      parent_id: commit.parentId,
      files_changed: commit.filesChanged,
      insertions: commit.insertions,
      deletions: commit.deletions,
      tree_hash: commit.treeHash,
      created_at: toIsoString(commit.createdAt),
    };
  }

  private toGitFileChange(change: {
    id: string;
    commitId: string;
    fileId: string | null;
    path: string;
    changeType: string;
    oldPath: string | null;
    oldHash: string | null;
    newHash: string | null;
    insertions: number;
    deletions: number;
  }): GitFileChange {
    return {
      id: change.id,
      commit_id: change.commitId,
      file_id: change.fileId || '',
      path: change.path,
      change_type: change.changeType as GitFileChange['change_type'],
      old_path: change.oldPath,
      old_hash: change.oldHash,
      new_hash: change.newHash,
      insertions: change.insertions,
      deletions: change.deletions,
    };
  }

  private async calculateTreeHash(fileRows: { path: string; sha256: string | null }[]): Promise<string> {
    const hashes = fileRows
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(f => `${f.path}:${f.sha256 || 'null'}`)
      .join('\n');

    const encoder = new TextEncoder();
    const data = encoder.encode(hashes);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  }

  private async calculateDiffStats(
    spaceId: string,
    fileId: string,
    oldHash: string | null,
    newHash: string | null
  ): Promise<{ insertions: number; deletions: number }> {
    let oldContent = '';
    let newContent = '';

    if (oldHash) {
      const snapshotKey = `git/${spaceId}/snapshots/${oldHash}`;
      const obj = await this.storage.get(snapshotKey);
      if (obj) {
        oldContent = await obj.text();
      }
    }

    if (newHash && fileId) {
      const r2Key = `spaces/${spaceId}/files/${fileId}`;
      const obj = await this.storage.get(r2Key);
      if (obj) {
        newContent = await obj.text();

        const snapshotKey = `git/${spaceId}/snapshots/${newHash}`;
        const exists = await this.storage.head(snapshotKey);
        if (!exists) {
          await this.storage.put(snapshotKey, newContent);
        }
      }
    }

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const insertions = Math.max(0, newLines.length - oldLines.length);
    const deletions = Math.max(0, oldLines.length - newLines.length);

    return { insertions, deletions };
  }

  private generateDiffHunks(oldContent: string, newContent: string): DiffHunk[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const hunks: DiffHunk[] = [];
    const lines: DiffLine[] = [];

    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldLines[oldIdx];
      const newLine = newLines[newIdx];

      if (oldIdx >= oldLines.length) {
        lines.push({
          type: 'add',
          content: newLine,
          newLineNumber: newIdx + 1,
        });
        newIdx++;
      } else if (newIdx >= newLines.length) {
        lines.push({
          type: 'delete',
          content: oldLine,
          oldLineNumber: oldIdx + 1,
        });
        oldIdx++;
      } else if (oldLine === newLine) {
        lines.push({
          type: 'context',
          content: oldLine,
          oldLineNumber: oldIdx + 1,
          newLineNumber: newIdx + 1,
        });
        oldIdx++;
        newIdx++;
      } else {
        lines.push({
          type: 'delete',
          content: oldLine,
          oldLineNumber: oldIdx + 1,
        });
        lines.push({
          type: 'add',
          content: newLine,
          newLineNumber: newIdx + 1,
        });
        oldIdx++;
        newIdx++;
      }
    }

    if (lines.length > 0) {
      hunks.push({
        oldStart: 1,
        oldLines: oldLines.length,
        newStart: 1,
        newLines: newLines.length,
        lines,
      });
    }

    return hunks;
  }
}
