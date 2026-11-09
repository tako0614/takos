import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../infra/db/schema.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import { createInMemoryObjectStore } from "../../../local-platform/in-memory-r2.ts";
import { putBlob, putTree, putCommit } from "../../../application/services/takos-git/local/core/object-store.ts";
import { pktLineString } from "../../../application/services/takos-git/local/core/pack-common.ts";
import { authDeps } from "../../middleware/auth.ts";
import gitSmartHttp from "../git-smart-http.ts";

const originalAuthDeps = { ...authDeps };
const client = createClient({ url: ":memory:" });
let env: Env;
let commitSha: string;

beforeAll(async () => {
  const directory = new URL("../../../../../db/migrations-control/migrations/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const name of migrations) await client.executeMultiple(await readFile(new URL(name, directory), "utf8"));
  await client.executeMultiple(`
    INSERT INTO accounts(id,type,status,name,slug,owner_account_id,created_at,updated_at) VALUES
      ('principal-a','user','active','Principal A','principal-a',NULL,'t0','t0'),
      ('principal-b','user','active','Principal B','principal-b',NULL,'t0','t0'),
      ('workspace-a','team','active','Workspace A','workspace-a','principal-a','t0','t0');
    INSERT INTO account_memberships(id,account_id,member_id,role,status,created_at,updated_at) VALUES
      ('membership-a','workspace-a','principal-a','owner','active','t0','t0');
    INSERT INTO repositories(id,account_id,name,visibility,default_branch) VALUES
      ('repo-private','workspace-a','private-repo','private','main'),
      ('repo-public','workspace-a','public-repo','public','main');
  `);
  const db = drizzle(client, { schema });
  const bucket = createInMemoryObjectStore();
  const blob = await putBlob(bucket, new TextEncoder().encode("synthetic private file\n"));
  const tree = await putTree(bucket, [{ mode: "100644", name: "README.md", sha: blob }]);
  const signature = { name: "Test", email: "test@example.invalid", timestamp: 1700000000, tzOffset: "+0000" };
  commitSha = await putCommit(bucket, { tree, parents: [], author: signature, committer: signature, message: "synthetic\n" });
  for (const repo of ["private", "public"]) {
    await client.execute({
      sql: "INSERT INTO branches(id,repo_id,name,commit_sha,is_default) VALUES (?,?,'main',?,1)",
      args: [`branch-${repo}`, `repo-${repo}`, commitSha],
    });
    await client.execute({
      sql: "INSERT INTO commits(id,repo_id,sha,tree_sha,author_name,author_email,author_date,committer_name,committer_email,commit_date,message) VALUES (?,?,?,?,'Test','test@example.invalid','t0','Test','test@example.invalid','t0','synthetic')",
      args: [`commit-${repo}`, `repo-${repo}`, commitSha, tree],
    });
  }
  env = {
    DB: db,
    GIT_OBJECTS: bucket,
    PLATFORM: {
      config: { oidcIssuerUrl: "https://synthetic.invalid" },
      services: { sql: { binding: db } },
    },
  } as unknown as Env;
});

afterEach(() => Object.assign(authDeps, originalAuthDeps));
afterAll(() => client.close());

function identity(scopes: string[], userId = "principal-a") {
  const user = {
    id: userId, email: "user@example.invalid", name: "User", username: userId,
    bio: null, picture: null, trust_tier: "normal", setup_completed: true,
    created_at: "t0", updated_at: "t0",
  } satisfies User;
  authDeps.resolveSelfIssuedBearer = async () => ({
    kind: "ok", user, userId, subject: "synthetic-owner", scopes,
  });
  authDeps.getCachedUser = async () => user;
  return user;
}

function request(endpoint: "refs" | "pack", repo = "private-repo", authenticated = true) {
  const path = `/git/workspace-a/${repo}.git/`;
  const headers = new Headers();
  if (authenticated) {
    headers.set("Authorization", "Basic " + btoa("synthetic:takpat_synthetic_private_git_scope"));
  }
  return endpoint === "refs"
    ? gitSmartHttp.request(path + "info/refs?service=git-upload-pack", { headers }, env)
    : gitSmartHttp.request(path + "git-upload-pack", {
      method: "POST", headers,
      body: Buffer.concat([pktLineString(`want ${commitSha}\n`), Buffer.from("0000"), pktLineString("done\n")]),
    }, env);
}

for (const endpoint of ["refs", "pack"] as const) {
  for (const scopes of [[], ["threads:read"], ["files:write"]]) {
    test(`private Git ${endpoint} rejects a valid owner token without files:read (${scopes.join(" ")})`, async () => {
      const user = identity(scopes);
      let cachedUserReads = 0;
      authDeps.getCachedUser = async () => { cachedUserReads += 1; return user; };
      const response = await request(endpoint);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "authentication required", code: "git_unauthorized" });
      expect(cachedUserReads).toBe(0);
    });
  }
}

test("private Git allows files:read and existing read/write/admin aliases for the actual member", async () => {
  for (const scopes of [["files:read"], ["read"], ["write"], ["admin"]]) {
    identity(scopes);
    const refs = await request("refs");
    expect(refs.status).toBe(200);
    expect(await refs.text()).toContain(commitSha + " HEAD");
    const pack = await request("pack");
    expect(pack.status).toBe(200);
    expect(pack.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
    expect(new TextDecoder().decode(await pack.arrayBuffer())).toContain("PACK");
  }
});

test("file authority does not replace actual Workspace membership", async () => {
  identity(["files:read"], "principal-b");
  for (const endpoint of ["refs", "pack"] as const) {
    expect((await request(endpoint)).status).toBe(404);
  }
});

test("anonymous public reads and private denial keep their existing behavior", async () => {
  for (const endpoint of ["refs", "pack"] as const) {
    expect((await request(endpoint, "public-repo", false)).status).toBe(200);
    expect((await request(endpoint, "private-repo", false)).status).toBe(401);
  }
});

test("a supplied invalid token cannot fall back to an anonymous public read", async () => {
  authDeps.resolveSelfIssuedBearer = async () => ({ kind: "invalid" });
  for (const endpoint of ["refs", "pack"] as const) {
    expect((await request(endpoint, "public-repo")).status).toBe(401);
  }
});
