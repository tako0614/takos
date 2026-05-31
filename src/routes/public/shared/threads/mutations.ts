import type {
  SqlDatabaseBinding,
  Thread,
  ThreadStatus,
} from "takos-api-contract/shared/types";
import { generateId } from "@takos/worker-platform-utils/id";
import { readSpaceMembershipRole } from "../spaces/access.ts";
import { readThreadAccess } from "./read-model.ts";

export type CreateThreadInput = {
  title?: string;
  locale?: "ja" | "en" | null;
};

export type UpdateThreadInput = {
  title?: string | null;
  locale?: "ja" | "en" | null;
  status?: ThreadStatus;
  context_window?: number;
};

export async function createSpaceThread(
  db: SqlDatabaseBinding,
  spaceId: string,
  actorAccountId: string,
  input: CreateThreadInput,
): Promise<Thread | null> {
  const role = await readSpaceMembershipRole(db, spaceId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!role) return null;

  const id = generateId();
  const timestamp = new Date().toISOString();
  await db.prepare(`
    INSERT INTO threads (
      id,
      account_id,
      title,
      locale,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    spaceId,
    input.title || null,
    input.locale ?? null,
    "active",
    timestamp,
    timestamp,
  ).run();

  const access = await readThreadAccess(db, id, actorAccountId);
  return access?.thread ?? null;
}

export async function updateThread(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  input: UpdateThreadInput,
): Promise<Thread | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const assignments: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];
  if (input.title !== undefined) {
    assignments.push("title = ?");
    values.push(input.title || null);
  }
  if (input.locale !== undefined) {
    assignments.push("locale = ?");
    values.push(input.locale);
  }
  if (input.status) {
    assignments.push("status = ?");
    values.push(input.status);
  }
  if (input.context_window !== undefined) {
    assignments.push("context_window = ?");
    values.push(input.context_window);
  }
  values.push(threadId);

  await db.prepare(`
    UPDATE threads
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).bind(...values).run();

  return (await readThreadAccess(db, threadId, actorAccountId))?.thread ?? null;
}

export async function deleteThread(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
): Promise<boolean> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
  ]);
  if (!access) return false;
  await updateThreadStatusUnchecked(db, threadId, "deleted");
  return true;
}

export async function setThreadArchived(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  archived: boolean,
): Promise<boolean> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return false;
  await updateThreadStatusUnchecked(
    db,
    threadId,
    archived ? "archived" : "active",
  );
  return true;
}

async function updateThreadStatusUnchecked(
  db: SqlDatabaseBinding,
  threadId: string,
  status: ThreadStatus,
): Promise<void> {
  await db.prepare(`
    UPDATE threads
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, new Date().toISOString(), threadId).run();
}
