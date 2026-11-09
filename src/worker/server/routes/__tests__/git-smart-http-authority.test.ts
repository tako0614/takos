import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
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
import { createWebWorker, webApp } from "../../../web.ts";

const originalAuthDeps = { ...authDeps };
const client = createClient({ url: ":memory:" });
let env: Env;
let commitSha: string;
let authorityCalls = 0;
let bindingReads = 0;

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
  const baseEnv = {
    DB: db,
    GIT_OBJECTS: bucket,
    PLATFORM: {
      config: { oidcIssuerUrl: "https://synthetic.invalid" },
      services: { sql: { binding: db } },
    },
  } as unknown as Env;
  env = new Proxy(baseEnv, {
    get(target, key, receiver) {
      bindingReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
});

beforeEach(() => { authorityCalls = 0; bindingReads = 0; });
afterEach(() => Object.assign(authDeps, originalAuthDeps));
afterAll(() => client.close());

function identity(scopes: string[], userId = "principal-a") {
  const user = {
    id: userId, email: "user@example.invalid", name: "User", username: userId,
    bio: null, picture: null, trust_tier: "normal", setup_completed: true,
    created_at: "t0", updated_at: "t0",
  } satisfies User;
  authDeps.resolveSelfIssuedBearer = async () => {
    authorityCalls += 1;
    return { kind: "ok", user, userId, subject: "synthetic-owner", scopes };
  };
  authDeps.getCachedUser = async () => { authorityCalls += 1; return user; };
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

async function expectQuarantined(response: Response) {
  expect(response.status).toBe(410);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("WWW-Authenticate")).toBeNull();
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.json()).toEqual({
    error: "Legacy Git hosting requires repository migration to the installed takos-git source.git.smart_http Interface.",
    code: "git_legacy_migration_required",
  });
  expect(authorityCalls).toBe(0);
  expect(bindingReads).toBe(0);
}

for (const endpoint of ["refs", "pack"] as const) {
  for (const scopes of [[], ["threads:read"], ["files:write"]]) {
    test("quarantine rejects " + endpoint + " without resolving scopes " + scopes.join(" "), async () => {
      identity(scopes);
      await expectQuarantined(await request(endpoint));
    });
  }
}

test("the actual Web mount quarantines legacy Git before static assets", async () => {
  let assetCalls = 0;
  const response = await webApp.request(
    "https://takos.test/git/workspace-a/public-repo.git/info/refs?service=git-upload-pack",
    {},
    {
      PLATFORM: {
        source: "node", bindings: {},
        config: { adminDomain: "takos.test", environment: "development" },
        services: {
          assets: { binding: { fetch: async () => {
            assetCalls += 1;
            return new Response("legacy-looking asset", {
              headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
            });
          } } },
        },
      },
    } as unknown as Env,
  );
  expect(response.status).toBe(410);
  expect(assetCalls).toBe(0);
});

test("the actual Worker rejects legacy Git before runtime initialization", async () => {
  let factoryCalls = 0;
  const unexpected = Error("quarantined request initialized the runtime");
  const worker = createWebWorker(async () => { factoryCalls += 1; throw unexpected; });
  const result = await worker.fetch(
    new Request("https://takos.test/git/workspace-a/private-repo.git/git-upload-pack", { method: "POST" }),
    {} as Env,
    {} as Parameters<typeof worker.fetch>[2],
  ).catch((error: unknown) => error);
  expect(factoryCalls).toBe(0);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(410);
});

test("ordinary Worker paths still initialize the selected runtime", async () => {
  let factoryCalls = 0;
  const unexpected = Error("runtime initialization probe");
  const worker = createWebWorker(async () => { factoryCalls += 1; throw unexpected; });
  const result = await worker.fetch(
    new Request("https://takos.test/gitlab"),
    {} as Env,
    {} as Parameters<typeof worker.fetch>[2],
  ).catch((error: unknown) => error);
  expect(factoryCalls).toBe(1);
  expect(result).toBe(unexpected);
});

test("read/write/admin authority does not reopen quarantined HTTP hosting", async () => {
  for (const scopes of [["read"], ["write"], ["admin"]]) {
    identity(scopes);
    await expectQuarantined(await request("refs"));
    await expectQuarantined(await request("pack"));
  }
});

test("non-members get the same migration response without an existence lookup", async () => {
  identity(["files:read"], "principal-b");
  await expectQuarantined(await request("refs"));
  await expectQuarantined(await request("pack"));
});

test("anonymous public and private reads stay quarantined", async () => {
  for (const endpoint of ["refs", "pack"] as const) {
    await expectQuarantined(await request(endpoint, "public-repo", false));
    await expectQuarantined(await request(endpoint, "private-repo", false));
  }
});

test("invalid credentials never trigger UserInfo or a new authentication challenge", async () => {
  authDeps.resolveSelfIssuedBearer = async () => { authorityCalls += 1; return { kind: "invalid" }; };
  await expectQuarantined(await request("refs", "public-repo"));
  await expectQuarantined(await request("pack", "public-repo"));
});

for (const endpoint of ["refs", "pack"] as const) {
  for (const repo of ["private-repo", "public-repo"]) {
    test(`legacy Git ${endpoint}/${repo} requires migration even for a file-authorized owner`, async () => {
      identity(["files:read"]);
      await expectQuarantined(await request(endpoint, repo));
    });
  }
}
