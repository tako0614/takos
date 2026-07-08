import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../../../../local-platform/in-memory-r2.ts";
import {
  getRawObject,
  putBlob,
  putCommit,
  putTree,
} from "../core/object-store.ts";
import {
  fetchRemoteRepository,
  ingestObjects,
} from "../remote-fetch.ts";
import gitSmartHttp from "../../../../../server/routes/git-smart-http.ts";

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

const sig = { name: "T", email: "t@e.com", timestamp: 1700000000, tzOffset: "+0000" };

async function seedServer() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(DDL);
  const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
  const bucket = createInMemoryObjectStore();

  const blobSha = await putBlob(bucket, new TextEncoder().encode("remote hi\n"));
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

  await client.execute({ sql: "INSERT INTO accounts (id, slug) VALUES ('a','alice')" });
  await client.execute({
    sql:
      "INSERT INTO repositories (id, account_id, name, visibility, default_branch) VALUES ('r','a','demo','public','main')",
  });
  await client.execute({
    sql:
      "INSERT INTO branches (id, repo_id, name, commit_sha, is_default) VALUES ('b','r','main',?,1)",
    args: [commitSha],
  });
  await client.execute({
    sql:
      `INSERT INTO commits (id, repo_id, sha, tree_sha, author_name, author_email,
        author_date, committer_name, committer_email, commit_date, message)
       VALUES ('c','r',?,?, 'T','t@e.com','2026','T','t@e.com','2026','init')`,
    args: [commitSha, treeSha],
  });

  return { db, bucket, blobSha, treeSha, commitSha };
}

describe("worker-native remote fetch (loopback against the serve route)", () => {
  let seeded: Awaited<ReturnType<typeof seedServer>>;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    seeded = await seedServer();
    const env = { DB: seeded.db, GIT_OBJECTS: seeded.bucket };
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => gitSmartHttp.fetch(req, env),
    });
    baseUrl = `http://127.0.0.1:${server.port}/git/alice/demo.git`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("real git clone over HTTP against the serve route", async () => {
    if (!HAS_GIT) return;
    const dir = mkdtempSync(join(tmpdir(), "takos-httpclone-"));
    try {
      // Use async Bun.spawn (not spawnSync): the serve route runs in THIS
      // process's event loop, so a blocking spawnSync would deadlock (git waits
      // on the server, the server can't run while the loop is blocked).
      const proc = Bun.spawn(["git", "clone", "-q", baseUrl, dir], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill(), 15000);
      const code = await proc.exited;
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`git clone failed (code=${code}): ${stderr}`);
      }
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("remote hi\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fetchRemoteRepository parses refs and unpacks objects", async () => {
    const result = await fetchRemoteRepository({
      url: baseUrl,
      allowPrivateHosts: true,
    });

    expect(result.defaultBranch).toBe("main");
    expect(result.refs).toEqual([
      { name: "refs/heads/main", target: seeded.commitSha },
    ]);

    const shas = new Set(result.objects.map((o) => o.sha));
    expect(shas.has(seeded.commitSha)).toBe(true);
    expect(shas.has(seeded.treeSha)).toBe(true);
    expect(shas.has(seeded.blobSha)).toBe(true);

    // Ingest into a fresh store and confirm the blob is retrievable.
    const dest = createInMemoryObjectStore();
    const written = await ingestObjects(dest, result.objects);
    expect(written).toBe(result.objects.length);
    const raw = await getRawObject(dest, seeded.blobSha);
    expect(raw).not.toBeNull();
    expect(new TextDecoder().decode(raw!)).toContain("remote hi\n");
  });

  test("rejects private/loopback IP-literal hosts (SSRF guard)", async () => {
    await expect(
      fetchRemoteRepository({ url: "http://127.0.0.1:1/git/x/y.git" }),
    ).rejects.toThrow(/private|loopback|blocked/i);
  });
});
