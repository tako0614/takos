/**
 * ActivityPub Followers Service — manages Follow/Unfollow for Store and Repo actors.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, apFollowers } from '../../../infra/db';
import { generateId } from '../../../shared/utils';

export interface FollowerRecord {
  id: string;
  targetActorUrl: string;
  followerActorUrl: string;
  createdAt: string;
}

export async function addFollower(
  dbBinding: D1Database,
  targetActorUrl: string,
  followerActorUrl: string,
): Promise<FollowerRecord> {
  const db = getDb(dbBinding);

  // Check duplicate
  const existing = await db.select({ id: apFollowers.id })
    .from(apFollowers)
    .where(and(
      eq(apFollowers.targetActorUrl, targetActorUrl),
      eq(apFollowers.followerActorUrl, followerActorUrl),
    ))
    .limit(1)
    .get();

  if (existing) {
    // Already following — return existing
    const row = await db.select().from(apFollowers)
      .where(eq(apFollowers.id, existing.id)).limit(1).get();
    return row!;
  }

  const id = generateId();
  const timestamp = new Date().toISOString();
  const record = { id, targetActorUrl, followerActorUrl, createdAt: timestamp };
  await db.insert(apFollowers).values(record);
  return record;
}

export async function removeFollower(
  dbBinding: D1Database,
  targetActorUrl: string,
  followerActorUrl: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const existing = await db.select({ id: apFollowers.id })
    .from(apFollowers)
    .where(and(
      eq(apFollowers.targetActorUrl, targetActorUrl),
      eq(apFollowers.followerActorUrl, followerActorUrl),
    ))
    .limit(1)
    .get();

  if (!existing) return false;
  await db.delete(apFollowers).where(eq(apFollowers.id, existing.id));
  return true;
}

export async function listFollowers(
  dbBinding: D1Database,
  targetActorUrl: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: string[] }> {
  const db = getDb(dbBinding);

  const [rows, totalResult] = await Promise.all([
    db.select({ followerActorUrl: apFollowers.followerActorUrl })
      .from(apFollowers)
      .where(eq(apFollowers.targetActorUrl, targetActorUrl))
      .orderBy(desc(apFollowers.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() })
      .from(apFollowers)
      .where(eq(apFollowers.targetActorUrl, targetActorUrl))
      .get(),
  ]);

  return {
    total: totalResult?.count ?? 0,
    items: rows.map((r: { followerActorUrl: string }) => r.followerActorUrl),
  };
}

export async function countFollowers(
  dbBinding: D1Database,
  targetActorUrl: string,
): Promise<number> {
  const db = getDb(dbBinding);
  const result = await db.select({ count: count() })
    .from(apFollowers)
    .where(eq(apFollowers.targetActorUrl, targetActorUrl))
    .get();
  return result?.count ?? 0;
}
