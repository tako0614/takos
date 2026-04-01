import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

import {
  createThreadWithMessages,
  createUser,
  createUserWithWorkspace,
  createWorkspace,
  resetIdCounter,
} from "./helpers/factories.ts";
import { createMockEnv } from "./setup.ts";

type CanonicalSpaceLike = {
  id: string;
  name: string;
  principal_id?: string;
  kind?: string;
  is_personal?: boolean | number;
};

type CanonicalUserLike = {
  id: string;
  principal_id?: string;
};

function getSpacePrincipalId(space: CanonicalSpaceLike): string | undefined {
  return space.principal_id;
}

function isPersonalSpace(space: CanonicalSpaceLike): boolean {
  return space.is_personal === true || space.is_personal === 1 ||
    space.kind === "user";
}

function getUserPrincipalId(user: CanonicalUserLike): string {
  return user.principal_id ?? (() => {
    throw new Error("principal_id is required in canonical test fixtures");
  })();
}

Deno.test("factories create a user with sensible defaults", () => {
  resetIdCounter();
  const user = createUser();

  assert(/^user-/.test(user.id));
  assertStringIncludes(user.email, "@test.example.com");
  assertStringIncludes(user.name, "Test User");
  assert(user.created_at !== undefined);
  assert(user.updated_at !== undefined);
});

Deno.test("factories create personal workspaces and memberships", () => {
  resetIdCounter();
  const space = createWorkspace({ kind: "user" });
  const { user, workspace, member } = createUserWithWorkspace();

  assertEquals(isPersonalSpace(space), true);
  assertEquals(isPersonalSpace(workspace), true);
  assertEquals(member.principal_id, getUserPrincipalId(user));
  assertEquals(member.space_id, workspace.id);
  assertEquals(member.role, "owner");
  assert(/^principal-/.test(getSpacePrincipalId(space) ?? ""));
});

Deno.test("thread factory creates ordered messages", () => {
  resetIdCounter();
  const { thread, messages } = createThreadWithMessages(
    { title: "Test Conversation" },
    [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ],
  );

  assertEquals(thread.title, "Test Conversation");
  assertEquals(messages.length, 3);
  assertEquals(messages[0].role, "user");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[2].sequence, 2);
});

Deno.test("mock D1 database supports prepare/bind/first/run", async () => {
  const env = createMockEnv();

  const first = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind("test-id")
    .first();
  const run = await env.DB.prepare("INSERT INTO users (id) VALUES (?)")
    .bind("test-id")
    .run();

  assertEquals(first, null);
  assertEquals(run.success, true);
  assertEquals(run.meta.changes, 1);
});

Deno.test("mock object stores and KV behave as expected", async () => {
  const env = createMockEnv();

  await env.TENANT_SOURCE.put("test-key", "test-content");
  const object = await env.TENANT_SOURCE.get("test-key");
  const missingObject = await env.TENANT_SOURCE.get("missing");

  await env.HOSTNAME_ROUTING.put("test-key", "test-value");
  const kvValue = await env.HOSTNAME_ROUTING.get("test-key");

  assertNotEquals(object, null);
  assertEquals(await object!.text(), "test-content");
  assertEquals(missingObject, null);
  assertEquals(kvValue, "test-value");
});

Deno.test("mock queues collect sent messages", async () => {
  const env = createMockEnv();

  await env.RUN_QUEUE.send({ runId: "run-1", timestamp: Date.now() });
  await env.RUN_QUEUE.sendBatch([
    { body: { runId: "run-2", timestamp: Date.now() } },
    { body: { runId: "run-3", timestamp: Date.now() } },
  ]);

  const messages = (env.RUN_QUEUE as any).getMessages();
  assertEquals(messages.length, 3);
  assertEquals(messages[0].body.runId, "run-1");
  assertEquals(messages[2].body.runId, "run-3");
});
