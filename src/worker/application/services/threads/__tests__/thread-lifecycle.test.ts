import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Env } from "../../../../shared/types/index.ts";
import * as schema from "../../../../infra/db/schema.ts";
import {
  checkThreadAccess,
  deleteThread,
  updateThread,
  updateThreadStatus,
} from "../thread-service.ts";

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT, picture TEXT,
      bio TEXT, email TEXT, trust_tier TEXT NOT NULL,
      setup_completed INTEGER NOT NULL, default_repository_id TEXT,
      head_snapshot_id TEXT, ai_model TEXT, model_backend TEXT,
      security_posture TEXT NOT NULL, owner_account_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, member_id TEXT NOT NULL,
      role TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT, locale TEXT,
      status TEXT NOT NULL, summary TEXT, key_points TEXT NOT NULL,
      retrieval_index INTEGER NOT NULL, context_window INTEGER NOT NULL,
      next_message_sequence INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE turn_projection_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      projection_kind TEXT NOT NULL, format_version INTEGER NOT NULL,
      algorithm_revision TEXT NOT NULL, source_start_sequence INTEGER NOT NULL,
      source_end_sequence INTEGER NOT NULL, projection_digest TEXT NOT NULL,
      projection_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_resource_tombstones (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      source_digest TEXT NOT NULL, deleted_by_account_id TEXT,
      deleted_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_resource_deletion_outbox (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      vector_ids TEXT NOT NULL, offload_object_keys TEXT NOT NULL,
      delivery_status TEXT NOT NULL, attempts INTEGER NOT NULL,
      claim_token TEXT, claimed_at TEXT, next_attempt_at TEXT,
      completed_at TEXT, last_error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, type, status, name, slug, trust_tier, setup_completed, ai_model,
      model_backend, security_posture, owner_account_id, created_at, updated_at
    ) VALUES
      ('user_owner', 'user', 'active', 'Owner', 'owner', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', NULL, '2026-08-10T00:00:00.000Z',
       '2026-08-10T00:00:00.000Z'),
      ('user_editor', 'user', 'active', 'Editor', 'editor', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', NULL, '2026-08-10T00:00:00.000Z',
       '2026-08-10T00:00:00.000Z'),
      ('space_a', 'team', 'active', 'Space A', 'space-a', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', 'user_owner', '2026-08-10T00:00:00.000Z',
       '2026-08-10T00:00:00.000Z');
    INSERT INTO account_memberships (
      id, account_id, member_id, role, status, updated_at, created_at
    ) VALUES
      ('membership_owner', 'space_a', 'user_owner', 'owner', 'active',
       '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
      ('membership_editor', 'space_a', 'user_editor', 'editor', 'active',
       '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');
    INSERT INTO threads (
      id, account_id, title, locale, status, summary, key_points,
      retrieval_index, context_window, next_message_sequence, created_at,
      updated_at
    ) VALUES (
      'thread_a', 'space_a', 'Original', 'ja', 'active', NULL, '[]', -1, 50,
      0, '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    );
    INSERT INTO turn_projection_revisions (
      id, account_id, run_id, thread_id, resource_id, projection_kind,
      format_version, algorithm_revision, source_start_sequence,
      source_end_sequence, projection_digest, projection_json, created_at
    ) VALUES (
      'projection_a', 'space_a', 'run_a', 'thread_a', 'projection_a',
      'run_model_input', 1, 'takos.run_model_input.v1', -1, 0,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{}', '2026-08-10T00:00:00.000Z'
    );
  `);
  return { client, db: drizzle(client, { schema }) };
}

test("deleted Threads cannot be read, edited, or revived through direct services", async () => {
  const fixture = await createFixture();
  try {
    expect(
      await checkThreadAccess(fixture.db, "thread_a", "user_editor"),
    ).toBeNull();
    expect(
      (await checkThreadAccess(fixture.db, "thread_a", "user_owner"))?.thread.id,
    ).toBe("thread_a");

    const archived = await updateThreadStatus(
      fixture.db,
      "thread_a",
      "archived",
    );
    expect(archived?.status).toBe("archived");
    expect((await updateThread(fixture.db, "thread_a", { title: "Renamed" }))?.title)
      .toBe("Renamed");

    expect(
      await deleteThread({} as Env, fixture.db, "thread_a"),
    ).toBe(true);
    expect(
      await checkThreadAccess(fixture.db, "thread_a", "user_owner"),
    ).toBeNull();
    expect(
      await updateThread(fixture.db, "thread_a", { title: "Revived" }),
    ).toBeNull();
    expect(
      await updateThreadStatus(fixture.db, "thread_a", "active"),
    ).toBeNull();
    expect(
      await deleteThread({} as Env, fixture.db, "thread_a"),
    ).toBe(false);

    const stored = await fixture.client.execute(
      "SELECT title, status FROM threads WHERE id = 'thread_a'",
    );
    expect(stored.rows[0]).toMatchObject({
      title: "Renamed",
      status: "deleted",
    });
    const retired = await fixture.client.execute(
      "SELECT id FROM turn_projection_revisions WHERE thread_id = 'thread_a'",
    );
    expect(retired.rows).toHaveLength(0);
    const deletion = await fixture.client.execute(
      `SELECT resource_kind, resource_id, vector_ids, delivery_status
         FROM agent_resource_deletion_outbox`,
    );
    expect(deletion.rows[0]).toMatchObject({
      resource_kind: "turn_projection",
      resource_id: "projection_a",
      vector_ids: "[]",
      delivery_status: "pending",
    });
  } finally {
    fixture.client.close();
  }
});
