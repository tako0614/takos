import { test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { assertEquals, assertRejects } from "@takos/test/assert";

import * as schema from "../../../../infra/db/schema.ts";
import { createInMemoryObjectStore } from "../../../../local-platform/in-memory-r2.ts";
import {
  putBlob,
  putCommit,
  putTree,
} from "../../../../application/services/takos-git/local/core/object-store.ts";
import { buildDetailedRepoDiffPayload } from "../diff.ts";

const REPO_ID = "repo_diff_test";

type TestBucket = ReturnType<typeof createInMemoryObjectStore>;

type Failure =
  { kind: "reject"; delayMs: number; message: string } | { kind: "never" };

function objectKey(sha: string): string {
  return `git/v2/objects/${sha.slice(0, 2)}/${sha.slice(2)}`;
}

function instrumentBucket(bucket: TestBucket) {
  const originalGet = bucket.get.bind(bucket);
  const failures = new Map<string, Failure>();
  let tracking = false;
  let active = 0;
  let maxActive = 0;

  bucket.get = async (key, options) => {
    const failure = failures.get(key);
    if (failure) {
      if (failure.kind === "never") {
        return await new Promise<never>(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
      throw new Error(failure.message);
    }

    if (!tracking) return originalGet(key, options);

    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      return await originalGet(key, options);
    } finally {
      active--;
    }
  };

  return {
    bucket,
    failures,
    startTracking() {
      tracking = true;
    },
    maxActive() {
      return maxActive;
    },
  };
}

async function createDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE branches (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      is_default INTEGER NOT NULL,
      is_protected INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      message TEXT,
      tagger_name TEXT,
      tagger_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE commits (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      sha TEXT NOT NULL,
      tree_sha TEXT NOT NULL,
      parent_shas TEXT,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      author_date TEXT NOT NULL,
      committer_name TEXT NOT NULL,
      committer_email TEXT NOT NULL,
      commit_date TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
  return { client, db: drizzle(client, { schema }) };
}

async function createCommit(
  bucket: TestBucket,
  entries: Array<{ mode: string; name: string; sha: string }>,
  message: string,
) {
  const tree = await putTree(bucket, entries);
  const signature = {
    name: "Diff test",
    email: "diff-test@example.test",
    timestamp: 1_700_000_000,
    tzOffset: "+0000",
  };
  const sha = await putCommit(bucket, {
    tree,
    parents: [],
    author: signature,
    committer: signature,
    message,
  });
  return { sha, tree };
}

async function insertCommit(
  client: Client,
  commit: { sha: string; tree: string },
) {
  await client.execute({
    sql: `INSERT INTO commits (
      id, repo_id, sha, tree_sha, author_name, author_email, author_date,
      committer_name, committer_email, commit_date, message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `commit-${commit.sha}`,
      REPO_ID,
      commit.sha,
      commit.tree,
      "Diff test",
      "diff-test@example.test",
      "2026-01-01T00:00:00.000Z",
      "Diff test",
      "diff-test@example.test",
      "2026-01-01T00:00:00.000Z",
      "diff fixture",
    ],
  });
}

function routeEnv(db: unknown, bucket: TestBucket) {
  return { DB: db, GIT_OBJECTS: bucket } as never;
}

test("detailed diffs run file work in bounded waves and preserve output order", async () => {
  const tracked = instrumentBucket(createInMemoryObjectStore());
  const { client, db } = await createDb();
  try {
    const blobSha = await putBlob(
      tracked.bucket,
      new TextEncoder().encode("added line\n"),
    );
    const headEntries = Array.from({ length: 205 }, (_, index) => ({
      mode: "100644",
      name: `file-${index.toString().padStart(3, "0")}.txt`,
      sha: blobSha,
    }));
    const base = await createCommit(tracked.bucket, [], "base\n");
    const head = await createCommit(tracked.bucket, headEntries, "head\n");
    await insertCommit(client, base);
    await insertCommit(client, head);

    tracked.startTracking();
    const result = await buildDetailedRepoDiffPayload(
      routeEnv(db, tracked.bucket),
      REPO_ID,
      base.sha,
      head.sha,
    );

    assertEquals(result.success, true);
    if (!result.success) return;
    assertEquals(result.payload.truncated, true);
    assertEquals(result.payload.files.length, 200);
    assertEquals(result.payload.files[0].path, "file-000.txt");
    assertEquals(result.payload.files.at(-1)?.path, "file-199.txt");
    assertEquals(tracked.maxActive() > 1, true);
    assertEquals(tracked.maxActive() <= 8, true);
  } finally {
    client.close();
  }
});

test("detailed diff errors do not wait for a later path that never settles", async () => {
  const tracked = instrumentBucket(createInMemoryObjectStore());
  const { client, db } = await createDb();
  try {
    const slowSha = await putBlob(
      tracked.bucket,
      new TextEncoder().encode("slow\n"),
    );
    const fastSha = await putBlob(
      tracked.bucket,
      new TextEncoder().encode("fast\n"),
    );
    const base = await createCommit(tracked.bucket, [], "base\n");
    const head = await createCommit(
      tracked.bucket,
      [
        { mode: "100644", name: "a.txt", sha: slowSha },
        { mode: "100644", name: "b.txt", sha: fastSha },
      ],
      "head\n",
    );
    await insertCommit(client, base);
    await insertCommit(client, head);
    tracked.failures.set(objectKey(slowSha), {
      kind: "reject",
      delayMs: 10,
      message: "a.txt failed",
    });
    tracked.failures.set(objectKey(fastSha), { kind: "never" });

    const error = await assertRejects(
      () =>
        buildDetailedRepoDiffPayload(
          routeEnv(db, tracked.bucket),
          REPO_ID,
          base.sha,
          head.sha,
        ),
      Error,
    );
    assertEquals((error as Error).message, "a.txt failed");
  } finally {
    client.close();
  }
}, 1_000);
