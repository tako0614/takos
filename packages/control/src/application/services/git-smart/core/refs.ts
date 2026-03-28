/**
 * Git ref management (branches & tags) — D1 with Drizzle + fallback.
 *
 * Adapted from git-store/refs.ts with SHA-1 (40-char) validation.
 */

import type { D1Database } from '../../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../../shared/types/drizzle-utils';
import type { GitBranch, GitTag, RefUpdateResult } from '../git-objects';
import { SHA1_PATTERN } from '../git-objects';
import { getDb, branches, tags } from '../../../../infra/db';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { generateId, toIsoString } from '../../../../shared/utils';
import { isInvalidArrayBufferError } from '../../../../shared/utils/db-guards';

const MAX_REPO_ID_LENGTH = 128;
const REPO_ID_PATTERN = /^[a-z0-9_-]+$/i;
const MAX_REF_NAME_LENGTH = 255;
const ASCII_PRINTABLE_PATTERN = /^[\x21-\x7E]+$/;
const INVALID_REF_CHARS_PATTERN = /[~^:?*[\\]/;
// Accept both SHA-1 (40) and legacy SHA-256 (64) for backward compat during migration
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}([a-f0-9]{24})?$/i;

const BRANCH_COLUMNS = `id, repo_id, name, commit_sha, is_default, is_protected, created_at, updated_at`;
const TAG_COLUMNS = `id, repo_id, name, commit_sha, message, tagger_name, tagger_email, created_at`;

type D1BranchRow = {
  id: string; repo_id: string; name: string; commit_sha: string;
  is_default: number; is_protected: number; created_at: string; updated_at: string;
};

type D1TagRow = {
  id: string; repo_id: string; name: string; commit_sha: string;
  message: string | null; tagger_name: string | null; tagger_email: string | null; created_at: string;
};

async function withDrizzleFallback<T>(
  drizzleOp: () => Promise<T>,
  fallbackOp: () => Promise<T>,
): Promise<T> {
  try {
    return await drizzleOp();
  } catch (error) {
    // Fall back to D1 raw queries for Drizzle adapter issues:
    // - Invalid array buffer length (large payload)
    // - D1 transient errors (SQLITE_BUSY, timeout)
    if (
      isInvalidArrayBufferError(error) ||
      (error instanceof Error && (
        error.message.includes('SQLITE_BUSY') ||
        error.message.includes('D1_ERROR') ||
        error.message.includes('database is locked')
      ))
    ) {
      return fallbackOp();
    }
    throw error;
  }
}

function toBranch(row: D1BranchRow): GitBranch {
  return {
    id: row.id, repo_id: row.repo_id, name: row.name, commit_sha: row.commit_sha,
    is_default: !!row.is_default, is_protected: !!row.is_protected,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function branchFromDrizzle(b: SelectOf<typeof branches>): GitBranch {
  return {
    id: b.id, repo_id: b.repoId, name: b.name, commit_sha: b.commitSha,
    is_default: b.isDefault, is_protected: b.isProtected,
    created_at: toIsoString(b.createdAt), updated_at: toIsoString(b.updatedAt),
  };
}

function toTag(row: D1TagRow): GitTag {
  return {
    id: row.id, repo_id: row.repo_id, name: row.name, commit_sha: row.commit_sha,
    message: row.message, tagger_name: row.tagger_name, tagger_email: row.tagger_email,
    created_at: row.created_at,
  };
}

function tagFromDrizzle(t: SelectOf<typeof tags>): GitTag {
  return {
    id: t.id, repo_id: t.repoId, name: t.name, commit_sha: t.commitSha,
    message: t.message, tagger_name: t.taggerName, tagger_email: t.taggerEmail,
    created_at: toIsoString(t.createdAt),
  };
}

function isValidRepoId(repoId: unknown): repoId is string {
  if (typeof repoId !== 'string') return false;
  const v = repoId.trim();
  return !!v && v.length <= MAX_REPO_ID_LENGTH && REPO_ID_PATTERN.test(v);
}

export function isValidRefName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const v = name.trim();
  if (!v || v.length > MAX_REF_NAME_LENGTH) return false;
  if (!ASCII_PRINTABLE_PATTERN.test(v)) return false;
  if (INVALID_REF_CHARS_PATTERN.test(v)) return false;
  if (v.includes('..') || v.includes('@{')) return false;
  if (v.endsWith('.') || v.endsWith('.lock')) return false;
  if (v.startsWith('/') || v.endsWith('/') || v.includes('//')) return false;
  return true;
}

function isValidCommitSha(sha: unknown): sha is string {
  return typeof sha === 'string' && COMMIT_SHA_PATTERN.test(sha);
}

export async function getBranch(dbBinding: D1Database, repoId: string, name: string): Promise<GitBranch | null> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return null;
  const db = getDb(dbBinding);
  return withDrizzleFallback(
    async () => {
      const row = await db.select().from(branches)
        .where(and(eq(branches.repoId, repoId), eq(branches.name, name)))
        .get();
      return row ? branchFromDrizzle(row) : null;
    },
    async () => {
      const row = await dbBinding.prepare(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE repo_id = ? AND name = ? LIMIT 1`)
        .bind(repoId, name).first<D1BranchRow>();
      return row ? toBranch(row) : null;
    },
  );
}

export async function getBranchesByNames(dbBinding: D1Database, repoId: string, names: string[]): Promise<Map<string, GitBranch>> {
  const validNames = names.filter(n => isValidRefName(n));
  if (!isValidRepoId(repoId) || validNames.length === 0) return new Map();
  const db = getDb(dbBinding);
  const result = await withDrizzleFallback(
    async () => {
      const rows = await db.select().from(branches)
        .where(and(eq(branches.repoId, repoId), inArray(branches.name, validNames)))
        .all();
      return rows.map(branchFromDrizzle);
    },
    async () => {
      const placeholders = validNames.map(() => '?').join(',');
      const rows = await dbBinding.prepare(
        `SELECT ${BRANCH_COLUMNS} FROM branches WHERE repo_id = ? AND name IN (${placeholders})`
      ).bind(repoId, ...validNames).all<D1BranchRow>();
      return (rows.results || []).map(toBranch);
    },
  );
  return new Map(result.map(b => [b.name, b]));
}

export async function getDefaultBranch(dbBinding: D1Database, repoId: string): Promise<GitBranch | null> {
  if (!isValidRepoId(repoId)) return null;
  const db = getDb(dbBinding);
  return withDrizzleFallback(
    async () => {
      const row = await db.select().from(branches)
        .where(and(eq(branches.repoId, repoId), eq(branches.isDefault, true)))
        .get();
      return row ? branchFromDrizzle(row) : null;
    },
    async () => {
      const row = await dbBinding.prepare(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE repo_id = ? AND is_default = 1 LIMIT 1`)
        .bind(repoId).first<D1BranchRow>();
      return row ? toBranch(row) : null;
    },
  );
}

export async function listBranches(dbBinding: D1Database, repoId: string): Promise<GitBranch[]> {
  if (!isValidRepoId(repoId)) return [];
  const db = getDb(dbBinding);
  return withDrizzleFallback(
    async () => {
      const rows = await db.select().from(branches)
        .where(eq(branches.repoId, repoId))
        .orderBy(desc(branches.isDefault), asc(branches.name))
        .all();
      return rows.map(branchFromDrizzle);
    },
    async () => {
      const result = await dbBinding.prepare(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE repo_id = ? ORDER BY is_default DESC, name ASC`)
        .bind(repoId).all<D1BranchRow>();
      return result.results.map(toBranch);
    },
  );
}

export async function createBranch(
  dbBinding: D1Database, repoId: string, name: string, commitSha: string, isDefault = false,
): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid branch name' };
  if (!isValidCommitSha(commitSha)) return { success: false, error: 'Invalid commit SHA' };

  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = new Date().toISOString();

  try {
    await db.insert(branches).values({
      id, repoId, name, commitSha, isDefault, isProtected: false, createdAt: timestamp, updatedAt: timestamp,
    });
    return { success: true };
  } catch {
    const existing = await getBranch(dbBinding, repoId, name);
    if (existing) return { success: false, current: existing.commit_sha, error: 'Branch already exists' };
    throw new Error('Failed to create branch');
  }
}

export async function updateBranch(
  dbBinding: D1Database, repoId: string, name: string, oldSha: string | null, newSha: string,
): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid branch name' };
  if ((oldSha !== null && !isValidCommitSha(oldSha)) || !isValidCommitSha(newSha)) return { success: false, error: 'Invalid commit SHA' };

  if (oldSha === null) return createBranch(dbBinding, repoId, name, newSha);

  const db = getDb(dbBinding);
  const timestamp = new Date().toISOString();
  const result = await db.update(branches)
    .set({ commitSha: newSha, updatedAt: timestamp })
    .where(and(eq(branches.repoId, repoId), eq(branches.name, name), eq(branches.commitSha, oldSha)))
    .returning()
    .all();

  if (result.length === 0) {
    const current = await getBranch(dbBinding, repoId, name);
    if (!current) return { success: false, error: 'Branch not found' };
    return { success: false, current: current.commit_sha, error: 'Ref conflict: branch was modified by another process' };
  }

  return { success: true };
}

export async function deleteBranch(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid branch name' };

  const branch = await getBranch(dbBinding, repoId, name);
  if (!branch) return { success: false, error: 'Branch not found' };
  if (branch.is_default) return { success: false, error: 'Cannot delete default branch' };
  if (branch.is_protected) return { success: false, error: 'Cannot delete protected branch' };

  const db = getDb(dbBinding);
  await db.delete(branches).where(and(eq(branches.repoId, repoId), eq(branches.name, name)));
  return { success: true };
}

export async function setDefaultBranch(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid branch name' };

  const branch = await getBranch(dbBinding, repoId, name);
  if (!branch) return { success: false, error: 'Branch not found' };

  const db = getDb(dbBinding);
  await db.update(branches).set({ isDefault: false }).where(eq(branches.repoId, repoId));
  await db.update(branches).set({ isDefault: true }).where(and(eq(branches.repoId, repoId), eq(branches.name, name)));
  return { success: true };
}

export async function getTag(dbBinding: D1Database, repoId: string, name: string): Promise<GitTag | null> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return null;
  const db = getDb(dbBinding);
  return withDrizzleFallback(
    async () => {
      const row = await db.select().from(tags)
        .where(and(eq(tags.repoId, repoId), eq(tags.name, name)))
        .get();
      return row ? tagFromDrizzle(row) : null;
    },
    async () => {
      const row = await dbBinding.prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE repo_id = ? AND name = ? LIMIT 1`)
        .bind(repoId, name).first<D1TagRow>();
      return row ? toTag(row) : null;
    },
  );
}

export async function listTags(dbBinding: D1Database, repoId: string): Promise<GitTag[]> {
  if (!isValidRepoId(repoId)) return [];
  const db = getDb(dbBinding);
  return withDrizzleFallback(
    async () => {
      const rows = await db.select().from(tags)
        .where(eq(tags.repoId, repoId))
        .orderBy(desc(tags.createdAt))
        .all();
      return rows.map(tagFromDrizzle);
    },
    async () => {
      const result = await dbBinding.prepare(`SELECT ${TAG_COLUMNS} FROM tags WHERE repo_id = ? ORDER BY created_at DESC`)
        .bind(repoId).all<D1TagRow>();
      return result.results.map(toTag);
    },
  );
}

export async function createTag(
  dbBinding: D1Database, repoId: string, name: string, commitSha: string,
  message?: string, taggerName?: string, taggerEmail?: string,
): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid tag name' };
  if (!isValidCommitSha(commitSha)) return { success: false, error: 'Invalid commit SHA' };

  const existing = await getTag(dbBinding, repoId, name);
  if (existing) return { success: false, current: existing.commit_sha, error: 'Tag already exists' };

  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = new Date().toISOString();

  try {
    await db.insert(tags).values({
      id, repoId, name, commitSha,
      message: message || null, taggerName: taggerName || null, taggerEmail: taggerEmail || null,
      createdAt: timestamp,
    });
    return { success: true };
  } catch {
    const existingNow = await getTag(dbBinding, repoId, name);
    if (existingNow) return { success: false, current: existingNow.commit_sha, error: 'Tag already exists' };
    throw new Error('Failed to create tag');
  }
}

export async function deleteTag(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult> {
  if (!isValidRepoId(repoId) || !isValidRefName(name)) return { success: false, error: 'Invalid tag name' };

  const tag = await getTag(dbBinding, repoId, name);
  if (!tag) return { success: false, error: 'Tag not found' };

  const db = getDb(dbBinding);
  await db.delete(tags).where(and(eq(tags.repoId, repoId), eq(tags.name, name)));
  return { success: true };
}

export async function resolveRef(dbBinding: D1Database, repoId: string, ref: string): Promise<string | null> {
  if (!isValidRepoId(repoId) || !isValidRefName(ref)) return null;

  let branch = await getBranch(dbBinding, repoId, ref);
  if (branch) return branch.commit_sha;

  const tag = await getTag(dbBinding, repoId, ref);
  if (tag) return tag.commit_sha;

  if (ref.startsWith('refs/heads/')) {
    branch = await getBranch(dbBinding, repoId, ref.slice('refs/heads/'.length));
    return branch?.commit_sha || null;
  }
  if (ref.startsWith('refs/remotes/')) {
    branch = await getBranch(dbBinding, repoId, ref.slice('refs/'.length));
    return branch?.commit_sha || null;
  }
  if (ref.startsWith('refs/tags/')) {
    const t = await getTag(dbBinding, repoId, ref.slice('refs/tags/'.length));
    return t?.commit_sha || null;
  }

  if (isValidCommitSha(ref)) return ref;
  return null;
}

export async function listAllRefs(
  dbBinding: D1Database, repoId: string,
): Promise<Array<{ name: string; target: string; type: 'branch' | 'tag' | 'remote' }>> {
  const [branchList, tagList] = await Promise.all([listBranches(dbBinding, repoId), listTags(dbBinding, repoId)]);

  return [
    ...branchList.map(b => {
      const isRemote = b.name.startsWith('remotes/');
      return {
        name: isRemote ? `refs/${b.name}` : `refs/heads/${b.name}`,
        target: b.commit_sha,
        type: (isRemote ? 'remote' : 'branch') as 'branch' | 'tag' | 'remote',
      };
    }),
    ...tagList.map(t => ({
      name: `refs/tags/${t.name}`,
      target: t.commit_sha,
      type: 'tag' as const,
    })),
  ];
}
