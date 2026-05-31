import {
  strict as assert,
} from "node:assert";
import { test } from "bun:test";

import {
  createThreadWithMessages,
  createUser,
  createUserWithWorkspace,
  createWorkspace,
  resetIdCounter,
} from "./helpers/factories.ts";
import { createMockEnv, MockQueue } from "./setup.ts";
import {
  RUN_QUEUE_MESSAGE_VERSION,
  type RunQueueMessage,
} from "@/shared/types/index.ts";

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

test("factories create a user with sensible defaults", () => {
  resetIdCounter();
  const user = createUser();

  assert(/^user-/.test(user.id));
  assert.ok(user.email.includes("@test.example.com"));
  assert.ok(user.name.includes("Test User"));
  assert(user.created_at !== undefined);
  assert(user.updated_at !== undefined);
});

test("factories create personal workspaces and memberships", () => {
  resetIdCounter();
  const space = createWorkspace({ kind: "user" });
  const { user, workspace, member } = createUserWithWorkspace();

  assert.deepStrictEqual(isPersonalSpace(space), true);
  assert.deepStrictEqual(isPersonalSpace(workspace), true);
  assert.deepStrictEqual(member.principal_id, getUserPrincipalId(user));
  assert.deepStrictEqual(member.space_id, workspace.id);
  assert.deepStrictEqual(member.role, "owner");
  assert(/^principal-/.test(getSpacePrincipalId(space) ?? ""));
});

test("thread factory creates ordered messages", () => {
  resetIdCounter();
  const { thread, messages } = createThreadWithMessages(
    { title: "Test Conversation" },
    [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ],
  );

  assert.deepStrictEqual(thread.title, "Test Conversation");
  assert.deepStrictEqual(messages.length, 3);
  assert.deepStrictEqual(messages[0].role, "user");
  assert.deepStrictEqual(messages[1].role, "assistant");
  assert.deepStrictEqual(messages[2].sequence, 2);
});

test("mock SQL database supports prepare/bind/first/run", async () => {
  const env = createMockEnv();

  const first = await env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind("test-id")
    .first();
  const run = await env.DB.prepare("INSERT INTO users (id) VALUES (?)")
    .bind("test-id")
    .run();

  assert.deepStrictEqual(first, null);
  assert.deepStrictEqual(run.success, true);
  assert.deepStrictEqual(run.meta.changes, 1);
});

test("mock object stores and kv stores behave as expected", async () => {
  const env = createMockEnv();
  assert(env.TENANT_SOURCE);

  await env.TENANT_SOURCE.put("test-key", "test-content");
  const object = await env.TENANT_SOURCE.get("test-key");
  const missingObject = await env.TENANT_SOURCE.get("missing");

  await env.HOSTNAME_ROUTING.put("test-key", "test-value");
  const kvValue = await env.HOSTNAME_ROUTING.get("test-key");

  assert.notStrictEqual(object, null);
  assert.deepStrictEqual(await object!.text(), "test-content");
  assert.deepStrictEqual(missingObject, null);
  assert.deepStrictEqual(kvValue, "test-value");
});

test("mock message queues collect sent messages", async () => {
  const env = createMockEnv();

  await env.RUN_QUEUE.send({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: "run-1",
    timestamp: Date.now(),
  });
  await env.RUN_QUEUE.sendBatch([
    {
      body: {
        version: RUN_QUEUE_MESSAGE_VERSION,
        runId: "run-2",
        timestamp: Date.now(),
      },
    },
    {
      body: {
        version: RUN_QUEUE_MESSAGE_VERSION,
        runId: "run-3",
        timestamp: Date.now(),
      },
    },
  ]);

  const messages = (env.RUN_QUEUE as MockQueue<RunQueueMessage>).getMessages();
  assert.deepStrictEqual(messages.length, 3);
  assert.deepStrictEqual(messages[0].body.runId, "run-1");
  assert.deepStrictEqual(messages[2].body.runId, "run-3");
});
