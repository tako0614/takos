import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import { base64UrlEncode, now } from '../../../shared/utils';
import { hashPassword, verifyPassword } from '../identity/auth-utils';
import { getDb, threadShares } from '../../../infra/db';
import { eq, and, isNull, desc } from 'drizzle-orm';

export type ThreadShareMode = 'public' | 'password';

export type ThreadShareRecord = {
  id: string;
  thread_id: string;
  space_id: string;
  created_by: string | null;
  token: string;
  mode: ThreadShareMode;
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
};

function toRecord(row: SelectOf<typeof threadShares>): ThreadShareRecord {
  return {
    id: row.id,
    thread_id: row.threadId,
    space_id: row.accountId,
    created_by: row.createdByAccountId,
    token: row.token,
    mode: (row.mode === 'password' ? 'password' : 'public') as ThreadShareMode,
    expires_at: row.expiresAt,
    revoked_at: row.revokedAt,
    last_accessed_at: row.lastAccessedAt,
    created_at: row.createdAt,
  };
}

export function generateThreadShareToken(): string {
  // 24 random bytes -> 32-char base64url (no padding)
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return base64UrlEncode(bytes);
}

export async function createThreadShare(params: {
  db: D1Database;
  threadId: string;
  spaceId: string;
  createdBy: string;
  mode: ThreadShareMode;
  password?: string | null;
  expiresAt?: string | null; // ISO
}): Promise<{ share: ThreadShareRecord; passwordRequired: boolean }> {
  const { db: d1, threadId, spaceId, createdBy } = params;
  const mode = params.mode;
  const token = generateThreadShareToken();
  const id = crypto.randomUUID();

  let passwordHash: string | null = null;
  if (mode === 'password') {
    const pw = (params.password || '').trim();
    if (pw.length < 8) {
      throw new Error('Password is required (min 8 characters)');
    }
    passwordHash = await hashPassword(pw);
  }

  let expiresAt: string | null = null;
  if (params.expiresAt) {
    const d = new Date(params.expiresAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid expires_at');
    }
    if (d.getTime() <= Date.now()) {
      throw new Error('expires_at must be in the future');
    }
    expiresAt = d.toISOString();
  }

  const createdAt = now();
  const db = getDb(d1);

  await db.insert(threadShares).values({
    id,
    threadId,
    accountId: spaceId,
    createdByAccountId: createdBy,
    token,
    mode,
    passwordHash,
    expiresAt,
    revokedAt: null,
    lastAccessedAt: null,
    createdAt,
  });

  const row = await db.select()
    .from(threadShares)
    .where(eq(threadShares.id, id))
    .get();

  if (!row) {
    throw new Error('Failed to create share');
  }

  return {
    share: toRecord(row),
    passwordRequired: mode === 'password',
  };
}

export async function listThreadShares(d1: D1Database, threadId: string): Promise<ThreadShareRecord[]> {
  const db = getDb(d1);
  const rows = await db.select()
    .from(threadShares)
    .where(eq(threadShares.threadId, threadId))
    .orderBy(desc(threadShares.createdAt))
    .all();

  return rows.map(toRecord);
}

export async function revokeThreadShare(params: {
  db: D1Database;
  threadId: string;
  shareId: string;
}): Promise<boolean> {
  const { db: d1, threadId, shareId } = params;
  const revokedAt = now();
  const db = getDb(d1);

  const result = await db.update(threadShares)
    .set({ revokedAt })
    .where(and(
      eq(threadShares.id, shareId),
      eq(threadShares.threadId, threadId),
      isNull(threadShares.revokedAt),
    ))
    .returning({ id: threadShares.id });

  return result.length > 0;
}

export async function getThreadShareByToken(d1: D1Database, token: string): Promise<(ThreadShareRecord & { password_hash: string | null }) | null> {
  const db = getDb(d1);
  const row = await db.select()
    .from(threadShares)
    .where(eq(threadShares.token, token))
    .get();

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt) {
    const t = Date.parse(row.expiresAt);
    if (Number.isFinite(t) && t <= Date.now()) {
      return null;
    }
  }

  return {
    ...toRecord(row),
    password_hash: row.passwordHash,
  };
}

export async function markThreadShareAccessed(d1: D1Database, shareId: string): Promise<void> {
  const db = getDb(d1);
  await db.update(threadShares)
    .set({ lastAccessedAt: now() })
    .where(eq(threadShares.id, shareId));
}

export async function verifyThreadShareAccess(params: {
  db: D1Database;
  token: string;
  password?: string | null;
}): Promise<{ share: ThreadShareRecord; threadId: string; spaceId: string } | { error: 'not_found' | 'password_required' | 'forbidden' }> {
  const { db, token } = params;
  const share = await getThreadShareByToken(db, token);
  if (!share) return { error: 'not_found' };

  if (share.mode === 'password') {
    const pw = (params.password || '').trim();
    if (!pw) {
      return { error: 'password_required' };
    }
    if (!share.password_hash) {
      return { error: 'forbidden' };
    }
    const ok = await verifyPassword(pw, share.password_hash);
    if (!ok) return { error: 'forbidden' };
  }

  await markThreadShareAccessed(db, share.id);

  return {
    share,
    threadId: share.thread_id,
    spaceId: share.space_id,
  };
}
