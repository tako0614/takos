import type { D1Database } from "../../../shared/types/bindings.ts";
import type { User } from "../../../shared/types/index.ts";
import { accounts, getDb as realGetDb } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { textDate } from "../../../shared/utils/db-guards.ts";

interface UserCacheContext {
  get(key: "user"): User | undefined;
  set(key: "user", value: User): void;
  env: { DB: D1Database };
}

const MAX_USER_ID_LENGTH = 128;
const USER_ID_PATTERN = /^[a-z0-9_-]+$/i;

export const userCacheDeps = {
  getDb: realGetDb,
};

function normalizeUserId(userId: unknown): string | null {
  if (typeof userId !== "string") return null;
  const value = userId.trim();
  if (!value) return null;
  if (value.length > MAX_USER_ID_LENGTH) return null;
  if (!USER_ID_PATTERN.test(value)) return null;
  return value;
}

export function isValidUserId(userId: unknown): userId is string {
  return normalizeUserId(userId) !== null;
}

export async function getCachedUser<C extends UserCacheContext>(
  c: C,
  userId: string,
): Promise<User | null> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const cachedUser = c.get("user");
  if (cachedUser && cachedUser.id === normalizedUserId) {
    return cachedUser;
  }

  const db = userCacheDeps.getDb(c.env.DB);
  const row = await db.select().from(accounts).where(
    eq(accounts.id, normalizedUserId),
  ).get();

  if (row) {
    const user: User = {
      id: row.id,
      principal_id: undefined,
      email: row.email ?? "",
      name: row.name,
      username: row.slug,
      principal_kind: "user",
      bio: row.bio,
      picture: row.picture,
      trust_tier: row.trustTier,
      setup_completed: row.setupCompleted,
      created_at: textDate(row.createdAt),
      updated_at: textDate(row.updatedAt),
    };
    c.set("user", user);
    return user;
  }

  return null;
}
