import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/env.ts";
import type { BaseVariables } from "../../../../server/routes/route-auth.ts";
import agentTasks from "../../../../server/routes/agent-tasks/routes.ts";
import reviews from "../../../../server/routes/pull-requests/reviews.ts";
import { sourceServiceDeps } from "../../source/deps.ts";
import { runAiReview } from "../../pull-requests/ai-review.ts";
import { indexThreadContext } from "../../agent/thread-context.ts";
import { handleThreadContext } from "../../../../runtime/indexer/handlers.ts";
import {
  operatorAiAuthorizationDeps,
  requireOperatorAiMembership,
} from "../operator-ai-authorization.ts";

const original = { ...operatorAiAuthorizationDeps };
const originalSpaceAccess = sourceServiceDeps.checkSpaceAccess;
afterEach(() => {
  Object.assign(operatorAiAuthorizationDeps, original);
  sourceServiceDeps.checkSpaceAccess = originalSpaceAccess;
});

const env = {
  APP_CAPSULE_ID: "cap-takos",
  OIDC_ISSUER_URL: "https://accounts.test",
  OIDC_CLIENT_ID: "takos",
  ENCRYPTION_KEY: "test-key",
  OPENAI_API_KEY: "operator-key",
} as Env;

function claimsResponse(claims: Record<string, unknown>, seen: string[]) {
  operatorAiAuthorizationDeps.accountsDelegatedAuthorization = async (input) => {
    seen.push(input.userId);
    return { accessToken: "actor-grant", subjectId: "external-actor" };
  };
  operatorAiAuthorizationDeps.fetch = async (_input, init) => {
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer actor-grant");
    return Response.json({ sub: "external-actor", ...claims });
  };
}

test("operator AI requires live exact-app membership, including after member removal", async () => {
  const seen: string[] = [];
  for (const role of ["owner", "member"]) {
    claimsResponse({ takosumi: { capsule_id: "cap-takos", app_role: role } }, seen);
    await requireOperatorAiMembership(env, "actor");
  }
  claimsResponse({ takosumi: { capsule_id: "cap-takos" } }, seen);
  await expect(requireOperatorAiMembership(env, "actor")).rejects.toMatchObject({ statusCode: 403 });
  expect(seen).toEqual(["actor", "actor", "actor"]);
});

test("legacy singleton Workspace members keep operator AI while foreign app and subject evidence fail closed", async () => {
  const seen: string[] = [];
  claimsResponse({ takosumi: { workspace_id: "legacy" }, workspace_memberships: ["legacy"] }, seen);
  await requireOperatorAiMembership(env, "actor");
  for (const claims of [
    { takosumi: { capsule_id: "foreign", app_role: "owner" } },
    { sub: "foreign-subject", takosumi: { capsule_id: "cap-takos", app_role: "owner" } },
    { takosumi: { capsule_id: "cap-takos", app_role: "admin" } },
  ]) {
    claimsResponse(claims, seen);
    await expect(requireOperatorAiMembership(env, "actor")).rejects.toThrow();
  }
});

test("operator AI fails closed on Accounts outages and needs an actor on configured apps", async () => {
  claimsResponse({}, []);
  operatorAiAuthorizationDeps.fetch = async () => new Response(null, { status: 503 });
  await expect(requireOperatorAiMembership(env, "actor")).rejects.toMatchObject({ statusCode: 503 });
  await expect(requireOperatorAiMembership(env, undefined)).rejects.toMatchObject({ statusCode: 403 });
  operatorAiAuthorizationDeps.accountsDelegatedAuthorization = async () => { throw new Error("must not read delegation"); };
  await requireOperatorAiMembership({ ...env, APP_CAPSULE_ID: undefined }, undefined);
});

test("task planning and PR review reject ordinary actors before using operator keys", async () => {
  const seen: string[] = [];
  claimsResponse({ takosumi: { capsule_id: "cap-takos" } }, seen);
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "requesting-user" } as never);
    await next();
  });
  app.onError((error, c) => c.json({}, "statusCode" in error && error.statusCode === 403 ? 403 : 500));
  app.route("/", agentTasks);
  const response = await app.request("/agent-tasks/task/plan", { method: "POST" }, { ...env, DB: {} } as Env);
  expect(response.status).toBe(403);
  await expect(runAiReview({
    env, userId: "requesting-user", repoId: "repo", spaceId: "space",
    pullRequest: { id: "pr", number: 1, title: "test", description: null, headBranch: "head", baseBranch: "main" },
  })).rejects.toMatchObject({ statusCode: 403 });
  expect(seen).toEqual(["requesting-user", "requesting-user"]);
});

const sourceKey = `agent-complete:${"a".repeat(64)}`;
const laterKey = `control-terminal:${"b".repeat(64)}`;
const sourceJobId = `index-outbox:${sourceKey}:thread_context`;

test("delayed indexing authorizes the originating Run and never borrows a later member's grant", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (id TEXT, account_id TEXT, thread_id TEXT, requester_account_id TEXT, completion_key TEXT);
    CREATE TABLE threads (id TEXT, account_id TEXT, retrieval_index INTEGER, summary TEXT, key_points TEXT);
    INSERT INTO runs VALUES ('source-run', 'workspace', 'thread', 'source-requester', '${sourceKey}');
    INSERT INTO runs VALUES ('later-member-run', 'workspace', 'thread', 'later-member', '${laterKey}');
    INSERT INTO runs VALUES ('foreign-account-run', 'other-workspace', 'thread', 'operator-owner', '${sourceKey}');
    INSERT INTO runs VALUES ('foreign-thread-run', 'workspace', 'other-thread', 'operator-owner', '${sourceKey}');
  `);
  const seen: string[] = [];
  claimsResponse({ takosumi: { capsule_id: "cap-takos" } }, seen);
  let aiCalls = 0;
  try {
    const input = {
      env: { ...env, DB: drizzle(client, { schema }), AI: { run: async () => { aiCalls++; return {}; } } } as never,
      spaceId: "workspace", threadId: "thread", sourceJobId,
    };
    await expect(indexThreadContext(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(seen).toEqual(["source-requester"]);
    expect(aiCalls).toBe(0);
    claimsResponse({ takosumi: { capsule_id: "cap-takos", app_role: "member" } }, seen);
    await expect(indexThreadContext(input)).resolves.toMatchObject({ summaryUpdated: false });
    await expect(indexThreadContext({ ...input, sourceJobId: `${sourceJobId}/continuation/second` })).resolves.toMatchObject({ summaryUpdated: false });
    expect(seen).toEqual(["source-requester", "source-requester", "source-requester"]);
    for (const missingSource of [undefined, "legacy-random-job", `${sourceJobId}/continuation/second/invalid`]) {
      await expect(indexThreadContext({ ...input, sourceJobId: missingSource })).rejects.toMatchObject({ statusCode: 403 });
    }
    await client.execute(`INSERT INTO runs VALUES ('ambiguous', 'workspace', 'thread', 'other-requester', '${sourceKey}')`);
    await expect(indexThreadContext(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(seen).toHaveLength(3);
  } finally {
    client.close();
  }
});

test("thread continuation retains the source Run and a removed member stops without retry", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (requester_account_id TEXT, account_id TEXT, thread_id TEXT, completion_key TEXT);
    CREATE TABLE threads (id TEXT, account_id TEXT, retrieval_index INTEGER, summary TEXT, key_points TEXT, updated_at TEXT);
    CREATE TABLE messages (id TEXT, thread_id TEXT, role TEXT, content TEXT, sequence INTEGER, created_at TEXT);
    INSERT INTO runs VALUES ('source-requester', 'workspace', 'thread', '${sourceKey}');
    INSERT INTO threads VALUES ('thread', 'workspace', -1, NULL, '[]', NULL);
    WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<200)
      INSERT INTO messages SELECT 'message-'||n, 'thread', 'user', 'test', n, '2026-10-29' FROM seq;
  `);
  const seen: string[] = [];
  const jobs: Array<{ jobId: string }> = [];
  const indexEnv = { ...env, DB: drizzle(client, { schema }), INDEX_QUEUE: { send: async (body: { jobId: string }) => { jobs.push(body); } } } as never;
  try {
    claimsResponse({ takosumi: { capsule_id: "cap-takos", app_role: "member" } }, seen);
    expect(await handleThreadContext(indexEnv, sourceJobId, "workspace", "thread")).toEqual({ processed: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobId.startsWith(`${sourceJobId}/continuation/`)).toBe(true);
    claimsResponse({ takosumi: { capsule_id: "cap-takos" } }, seen);
    expect(await handleThreadContext(indexEnv, jobs[0]!.jobId, "workspace", "thread")).toEqual({ processed: false, reason: "app_membership_required", retryable: false });
    expect(seen).toEqual(["source-requester", "source-requester"]);
    operatorAiAuthorizationDeps.fetch = async () => new Response(null, { status: 503 });
    await expect(handleThreadContext(indexEnv, jobs[0]!.jobId, "workspace", "thread")).rejects.toMatchObject({ statusCode: 503 });
  } finally {
    client.close();
  }
});

test("AI review HTTP route preserves membership denial and temporary Accounts failure", async () => {
  const seen: string[] = [];
  const db = {
    select() {
      return {
        table: schema.repositories,
        from(table: typeof schema.repositories) { this.table = table; return this; },
        where() { return this; },
        async get() {
          return this.table === schema.repositories
            ? { id: "repo", accountId: "workspace", name: "repo", visibility: "private" }
            : { id: "pr", number: 1, title: "test", headBranch: "head", baseBranch: "main" };
        },
      };
    },
    insert() {}, update() {}, delete() {},
  };
  sourceServiceDeps.checkSpaceAccess = async (_db, workspace, actor) => {
    expect(workspace).toBe("workspace");
    expect(actor).toBe("requesting-user");
    return { space: { id: workspace } } as never;
  };
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => { c.set("user", { id: "requesting-user" } as never); await next(); });
  app.onError((error, c) => {
    const status = "statusCode" in error ? error.statusCode : 500;
    return c.json({}, status === 403 ? 403 : status === 503 ? 503 : 500);
  });
  app.route("/", reviews);
  claimsResponse({ takosumi: { capsule_id: "cap-takos" } }, seen);
  const denied = await app.request("/repos/repo/pulls/1/ai-review", { method: "POST" }, { ...env, DB: db } as never);
  expect(denied.status).toBe(403);
  operatorAiAuthorizationDeps.fetch = async () => new Response(null, { status: 503 });
  const unavailable = await app.request("/repos/repo/pulls/1/ai-review", { method: "POST" }, { ...env, DB: db } as never);
  expect(unavailable.status).toBe(503);
  expect(seen).toEqual(["requesting-user", "requesting-user"]);
});
