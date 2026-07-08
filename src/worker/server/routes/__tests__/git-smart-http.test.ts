import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { pktLineString } from "../../../application/services/takos-git/local/core/pack-common.ts";
import gitSmartHttp from "../git-smart-http.ts";

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}
const HAS_GIT = gitAvailable();

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
    sql:
      "INSERT INTO repositories (id, account_id, name, visibility, default_branch) VALUES (?, ?, ?, ?, ?)",
    args: ["repo1", "acc1", "demo", "public", "main"],
  });
  await client.execute({
    sql:
      "INSERT INTO branches (id, repo_id, name, commit_sha, is_default) VALUES (?, ?, ?, ?, 1)",
    args: ["b1", "repo1", "main", commitSha],
  });
  await client.execute({
    sql:
      `INSERT INTO commits (id, repo_id, sha, tree_sha, author_name, author_email,
         author_date, committer_name, committer_email, commit_date, message)
       VALUES (?, ?, ?, ?, 'A', 'a@x', '2026', 'A', 'a@x', '2026', 'init')`,
    args: ["c1", "repo1", commitSha, treeSha],
  });

  return { db, bucket, blobSha, treeSha, commitSha };
}

describe("git smart HTTP serve route", () => {
  let seeded: Awaited<ReturnType<typeof seedRepo>>;
  let env: { DB: SqlDatabaseBinding; GIT_OBJECTS: unknown };
  let dir = "";

  beforeAll(async () => {
    seeded = await seedRepo();
    env = { DB: seeded.db, GIT_OBJECTS: seeded.bucket };
    if (HAS_GIT) dir = mkdtempSync(join(tmpdir(), "takos-serve-"));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("info/refs advertises HEAD symref, branch, and capabilities", async () => {
    const res = await gitSmartHttp.request(
      "/git/alice/demo.git/info/refs?service=git-upload-pack",
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-advertisement",
    );
    const text = await res.text();
    expect(text).toContain("# service=git-upload-pack");
    expect(text).toContain(`${seeded.commitSha} HEAD`);
    expect(text).toContain("symref=HEAD:refs/heads/main");
    expect(text).toContain(`${seeded.commitSha} refs/heads/main`);
  });

  test("receive-pack (push) is refused", async () => {
    const res = await gitSmartHttp.request(
      "/git/alice/demo.git/info/refs?service=git-receive-pack",
      {},
      env,
    );
    expect(res.status).toBe(403);
  });

  test("unknown repo is 404", async () => {
    const res = await gitSmartHttp.request(
      "/git/alice/nope.git/info/refs?service=git-upload-pack",
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  test("upload-pack rejects a want that is not an advertised tip (IDOR guard)", async () => {
    const body = pktLineString(`want ${"a".repeat(40)}\n`);
    const res = await gitSmartHttp.request(
      "/git/alice/demo.git/git-upload-pack",
      { method: "POST", body: body.buffer as ArrayBuffer },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("git_invalid_want");
  });

  test("upload-pack returns a valid pack that real git accepts", async () => {
    const body = new Uint8Array([
      ...pktLineString(`want ${seeded.commitSha}\n`),
      ...new TextEncoder().encode("0000"),
      ...pktLineString("done\n"),
    ]);
    const res = await gitSmartHttp.request(
      "/git/alice/demo.git/git-upload-pack",
      { method: "POST", body: body.buffer as ArrayBuffer },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-result",
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    // Strip the leading "0008NAK\n" pkt-line; the rest is the packfile.
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("0008NAK\n");
    const pack = bytes.subarray(8);

    if (!HAS_GIT) return;
    const repo = mkdtempSync(join(tmpdir(), "takos-clone-"));
    try {
      spawnSync("git", ["init", "-q", repo], { stdio: "ignore" });
      const unpack = spawnSync("git", ["-C", repo, "unpack-objects", "-q"], {
        input: pack,
      });
      expect(unpack.status).toBe(0);
      const cat = spawnSync("git", ["-C", repo, "cat-file", "-p", seeded.blobSha]);
      expect(cat.stdout.toString()).toBe("hi\n");
      const type = spawnSync("git", ["-C", repo, "cat-file", "-t", seeded.commitSha]);
      expect(type.stdout.toString().trim()).toBe("commit");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
