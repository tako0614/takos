/**
 * Push Activities Service — records ForgeFed Push activities for repo outbox.
 */

import { count, desc, eq } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, repoPushActivities } from '../../../infra/db';
import { generateId } from '../../../shared/utils';

export interface CommitMeta {
  hash: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committed: string;
}

export interface RecordPushInput {
  repoId: string;
  accountId: string;
  ref: string;
  beforeSha: string | null;
  afterSha: string;
  pusherName: string | null;
  pusherActorUrl?: string | null;
  commitCount: number;
  commits?: CommitMeta[];
}

export interface PushActivityRecord {
  id: string;
  repoId: string;
  accountId: string;
  ref: string;
  beforeSha: string | null;
  afterSha: string;
  pusherActorUrl: string | null;
  pusherName: string | null;
  commitCount: number;
  commits: CommitMeta[];
  createdAt: string;
}

export async function recordPushActivity(
  dbBinding: D1Database,
  input: RecordPushInput,
): Promise<PushActivityRecord> {
  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = new Date().toISOString();
  const commits = input.commits ?? [];

  const record = {
    id,
    repoId: input.repoId,
    accountId: input.accountId,
    ref: input.ref,
    beforeSha: input.beforeSha,
    afterSha: input.afterSha,
    pusherActorUrl: input.pusherActorUrl ?? null,
    pusherName: input.pusherName,
    commitCount: input.commitCount,
    commitsJson: commits.length > 0 ? JSON.stringify(commits) : null,
    createdAt: timestamp,
  };

  await db.insert(repoPushActivities).values(record);
  return { ...record, commits };
}

export async function listPushActivities(
  dbBinding: D1Database,
  repoId: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: PushActivityRecord[] }> {
  const db = getDb(dbBinding);

  const [rows, totalResult] = await Promise.all([
    db.select()
      .from(repoPushActivities)
      .where(eq(repoPushActivities.repoId, repoId))
      .orderBy(desc(repoPushActivities.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() })
      .from(repoPushActivities)
      .where(eq(repoPushActivities.repoId, repoId))
      .get(),
  ]);

  return {
    total: totalResult?.count ?? 0,
    items: rows.map((row: typeof repoPushActivities.$inferSelect) => ({
      id: row.id,
      repoId: row.repoId,
      accountId: row.accountId,
      ref: row.ref,
      beforeSha: row.beforeSha,
      afterSha: row.afterSha,
      pusherActorUrl: row.pusherActorUrl,
      pusherName: row.pusherName,
      commitCount: row.commitCount,
      commits: parseCommits(row.commitsJson),
      createdAt: row.createdAt,
    })),
  };
}

function parseCommits(json: string | null): CommitMeta[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as CommitMeta[];
  } catch {
    return [];
  }
}
