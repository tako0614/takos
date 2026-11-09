import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../../local-platform/in-memory-r2.ts";
import {
  putBlob,
  putCommit,
  putTree,
} from "../../../application/services/takos-git/local/core/object-store.ts";
import { collectReachableObjects } from "../../../application/services/takos-git/index.ts";
import { writePackFromShas } from "../../../application/services/takos-git/local/core/pack.ts";
import { toGitBucket } from "../../../shared/utils/git-bucket.ts";
import gitSmartHttp from "../git-smart-http.ts";


const DDL = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
CREATE TABLE repositories (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT, visibility TEXT NOT NULL DEFAULT 'private',
  default_branch TEXT NOT NULL DEFAULT 'main', forked_from_id TEXT,
  remote_clone_url TEXT, remote_store_actor_url TEXT,
  stars INTEGER NOT NULL DEFAULT 0, forks INTEGER NOT NULL DEFAULT 0,
  git_enabled INTEGER NOT NULL DEFAULT 0, primary_language TEXT, license TEXT,
  featured INTEGER NOT NULL DEFAULT 0, install_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE branches (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, name TEXT NOT NULL,
  commit_sha TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, name TEXT NOT NULL,
  commit_sha TEXT NOT NULL, message TEXT, tagger_name TEXT, tagger_email TEXT,
  created_at TEXT
);
CREATE TABLE commits (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, sha TEXT NOT NULL,
  tree_sha TEXT NOT NULL, parent_shas TEXT, author_name TEXT NOT NULL,
  author_email TEXT NOT NULL, author_date TEXT NOT NULL,
  committer_name TEXT NOT NULL, committer_email TEXT NOT NULL,
  commit_date TEXT NOT NULL, message TEXT NOT NULL
);
`;

const sig = {
  name: "Takos Test",
  email: "t@e.com",
  timestamp: 1700000000,
  tzOffset: "+0000",
};

async function seedRepo() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(DDL);
  const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
  const bucket = createInMemoryObjectStore();

  const blobSha = await putBlob(bucket, new TextEncoder().encode("hi\n"));
  const treeSha = await putTree(bucket, [
    { mode: "100644", name: "README.md", sha: blobSha },
  ]);
  const commitSha = await putCommit(bucket, {
    tree: treeSha,
    parents: [],
    author: sig,
    committer: sig,
    message: "init\n",
  });

  await client.execute({
    sql: "INSERT INTO accounts (id, slug) VALUES (?, ?)",
    args: ["acc1", "alice"],
  });
  await client.execute({
    sql: "INSERT INTO repositories (id, account_id, name, visibility, default_branch) VALUES (?, ?, ?, ?, ?)",
    args: ["repo1", "acc1", "demo", "public", "main"],
  });
  await client.execute({
    sql: "INSERT INTO branches (id, repo_id, name, commit_sha, is_default) VALUES (?, ?, ?, ?, 1)",
    args: ["b1", "repo1", "main", commitSha],
  });
  await client.execute({
    sql: `INSERT INTO commits (id, repo_id, sha, tree_sha, author_name, author_email,
         author_date, committer_name, committer_email, commit_date, message)
       VALUES (?, ?, ?, ?, 'A', 'a@x', '2026', 'A', 'a@x', '2026', 'init')`,
    args: ["c1", "repo1", commitSha, treeSha],
  });

  return { client, db, bucket, blobSha, treeSha, commitSha };
}

const expectedError = {
  error: "Legacy Git hosting requires repository migration to the installed takos-git source.git.smart_http Interface.",
  code: "git_legacy_migration_required",
};

describe("Worker-native Git quarantine", () => {
  let seeded: Awaited<ReturnType<typeof seedRepo>>;
  let env: { DB: SqlDatabaseBinding; GIT_OBJECTS: unknown };
  let bindingReads = 0;

  beforeAll(async () => {
    seeded = await seedRepo();
    env = new Proxy({ DB: seeded.db, GIT_OBJECTS: seeded.bucket }, {
      get(target, key, receiver) {
        bindingReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
  });
  beforeEach(() => { bindingReads = 0; });
  afterAll(() => seeded.client.close());

  async function snapshot() {
    const tables = await Promise.all(
      ["accounts", "repositories", "branches", "tags", "commits"].map(async (table) => ({
        table,
        rows: (await seeded.client.execute("SELECT * FROM " + table + " ORDER BY id"))
          .rows.map((row) => Object.fromEntries(Object.entries(row))),
      })),
    );
    const listing = await seeded.bucket.list();
    if (listing.truncated) throw Error("incomplete fixture object snapshot");
    const objects = await Promise.all(
      [...listing.objects].sort((a, b) => a.key.localeCompare(b.key)).map(async ({ key }) => {
        const object = await seeded.bucket.get(key);
        if (!object) throw Error("fixture object missing");
        return { key, bytes: Buffer.from(await object.arrayBuffer()).toString("hex") };
      }),
    );
    return { tables, objects };
  }

  for (const [method, path] of [
    ["GET", "/git/alice/demo.git/info/refs?service=git-upload-pack"],
    ["GET", "/git/alice/demo.git/info/refs?service=git-receive-pack"],
    ["GET", "/git/alice/nope.git/info/refs?service=git-upload-pack"],
    ["POST", "/git/alice/demo.git/git-upload-pack"],
    ["POST", "/git/alice/demo.git/git-receive-pack"],
    ["GET", "/git/alice/demo.git/info/refs"],
    ["GET", "/git/unknown/path"],
    ["GET", "/git"],
    ["HEAD", "/git/alice/demo.git/info/refs?service=git-upload-pack"],
    ["OPTIONS", "/git/alice/demo.git/git-upload-pack"],
    ["PUT", "/git/alice/demo.git/git-upload-pack"],
    ["PATCH", "/git/alice/demo.git/git-upload-pack"],
    ["DELETE", "/git/alice/demo.git/git-upload-pack"],
  ]) {
    test(method + " " + path + " is quarantined without touching legacy data", async () => {
      const before = await snapshot();
      const response = await gitSmartHttp.request(path!, { method }, env);
      expect(response.status).toBe(410);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(await response.json()).toEqual(expectedError);
      expect(bindingReads).toBe(0);
      expect(await snapshot()).toEqual(before);
    });
  }

  test("quarantine does not consume an upload-pack or receive-pack body", async () => {
    for (const endpoint of ["git-upload-pack", "git-receive-pack"]) {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls > 2) controller.close();
          else controller.enqueue(new Uint8Array(64 * 1024));
        },
      }, { highWaterMark: 0 });
      const response = await gitSmartHttp.request("/git/alice/demo.git/" + endpoint, {
        method: "POST", body, duplex: "half",
      } as RequestInit & { duplex: "half" }, env);
      expect(response.status).toBe(410);
      expect(pulls).toBe(0);
      expect(bindingReads).toBe(0);
    }
  });

  test("unrelated paths remain outside the compatibility router", async () => {
    expect((await gitSmartHttp.request("/health")).status).toBe(404);
    expect((await gitSmartHttp.request("/gitlab")).status).toBe(404);
  });

  test("retained legacy objects remain recoverable by actual pack tooling", async () => {
    const before = await snapshot();
    const bucket = toGitBucket(seeded.bucket);
    const shas = await collectReachableObjects(
      seeded.db, bucket, "repo1", [seeded.commitSha], new Set(),
    );
    const { pack, missing } = await writePackFromShas(bucket, shas);
    expect(missing).toEqual([]);
    expect(new TextDecoder().decode(pack.subarray(0, 4))).toBe("PACK");
    expect(spawnSync("git", ["--version"], { stdio: "ignore" }).status).toBe(0);
    const repo = mkdtempSync(join(tmpdir(), "takos-quarantine-recovery-"));
    try {
      expect(spawnSync("git", ["init", "-q", repo]).status).toBe(0);
      const unpack = spawnSync("git", ["-C", repo, "unpack-objects", "-q"], { input: pack });
      expect(unpack.status).toBe(0);
      const blob = spawnSync("git", ["-C", repo, "cat-file", "-p", seeded.blobSha]);
      expect(blob.status).toBe(0);
      expect(blob.stdout.toString()).toBe("hi\n");
      const commit = spawnSync("git", ["-C", repo, "cat-file", "-t", seeded.commitSha]);
      expect(commit.status).toBe(0);
      expect(commit.stdout.toString().trim()).toBe("commit");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
    expect(await snapshot()).toEqual(before);
  });
});
