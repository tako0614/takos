import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../../../shared/types/bindings.ts";
import { getCommitsFromIndex } from "../commit-index.ts";

/**
 * Guards the batched branch-head commit lookup that replaced the per-branch N+1
 * in GET /repos/:id/branches?include_commits=true. The lookup must be repo
 * scoped and survive a sha set larger than the D1 100-bound-parameter cap via
 * chunking.
 */

async function makeDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE commits (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      sha TEXT NOT NULL,
      tree_sha TEXT NOT NULL,
      parent_shas TEXT,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      author_date TEXT,
      committer_name TEXT NOT NULL,
      committer_email TEXT NOT NULL,
      commit_date TEXT,
      message TEXT NOT NULL
    );
  `);
  return { client, db: drizzle(client, { schema }) as unknown as SqlDatabaseBinding };
}

async function insertCommit(
  client: Awaited<ReturnType<typeof makeDb>>["client"],
  repoId: string,
  sha: string,
) {
  await client.execute({
    sql:
      `INSERT INTO commits (id, repo_id, sha, tree_sha, author_name, author_email,
         author_date, committer_name, committer_email, commit_date, message)
       VALUES (?, ?, ?, 'tree', 'A', 'a@x', '2026-01-01', 'A', 'a@x', '2026-01-01', ?)`,
    args: [`id_${sha}`, repoId, sha, `msg ${sha}`],
  });
}

test("getCommitsFromIndex returns present shas, omits absent, stays repo-scoped", async () => {
  const { client, db } = await makeDb();
  await insertCommit(client, "repo_1", "sha_a");
  await insertCommit(client, "repo_1", "sha_b");
  await insertCommit(client, "repo_other", "sha_c"); // different repo

  const map = await getCommitsFromIndex(db, "repo_1", [
    "sha_a",
    "sha_b",
    "sha_c", // belongs to repo_other -> must NOT resolve under repo_1
    "sha_missing",
  ]);

  assertEquals(map.has("sha_a"), true);
  assertEquals(map.has("sha_b"), true);
  assertEquals(map.has("sha_c"), false);
  assertEquals(map.has("sha_missing"), false);
  assertEquals(map.get("sha_a")?.message, "msg sha_a");
});

test("getCommitsFromIndex chunks past the D1 bound-parameter cap", async () => {
  const { client, db } = await makeDb();
  const shas = Array.from({ length: 95 }, (_, i) => `sha_${i}`);
  for (const sha of shas) await insertCommit(client, "repo_1", sha);

  const map = await getCommitsFromIndex(db, "repo_1", shas);
  assertEquals(map.size, 95);
});

test("getCommitsFromIndex returns an empty map for no shas", async () => {
  const { db } = await makeDb();
  const map = await getCommitsFromIndex(db, "repo_1", []);
  assertEquals(map.size, 0);
});
