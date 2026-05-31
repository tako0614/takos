import { assertEquals } from "@std/assert";
import { assertSpyCalls, type Spy, spy } from "@std/testing/mock";
import type {
  MessageQueueBatch,
  MessageQueueMessage,
} from "../../../shared/types/bindings.ts";
import type { WorkflowQueueEnv } from "../../../runtime/queues/workflow-types.ts";
import type { DeploymentEnv } from "../../../application/services/deployment/index.ts";
import {
  noopDurableObjectNamespace,
  noopKvStoreBinding,
  noopMessageQueueBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";

// The runner's queue handler reads `body`, `ack`, `retry`, and `attempts` on
// each message. Other MessageQueueMessage fields (`id`, `timestamp`) are
// untouched in the runner branches under test, so a typed structural mock is
// enough; the ack/retry spies are returned alongside the message so individual
// tests can assert on them.
type MockMessage = MessageQueueMessage<unknown> & {
  ack: Spy<unknown, [], void>;
  retry: Spy<unknown, [{ delaySeconds?: number }?], void>;
};

function createMessage(body: unknown, attempts = 1): MockMessage {
  return {
    id: "test-message-id",
    timestamp: new Date(),
    attempts,
    body,
    ack: spy(() => {}),
    retry: spy((_options?: { delaySeconds?: number }) => {}),
  };
}

function createBatch(
  queue: string,
  messages: MockMessage[],
): MessageQueueBatch<unknown> {
  return { queue, messages };
}

// Minimal workflow env: validateWorkflowRunnerEnv only checks DB presence.
const minimalEnv: WorkflowQueueEnv = {
  DB: noopSqlDatabaseBinding(),
  RUN_NOTIFIER: noopDurableObjectNamespace(),
};

// Deployment env exposes the additional bindings the deployment-path guards
// check via `isDeploymentEnv` (RUN_QUEUE / HOSTNAME_ROUTING / ENCRYPTION_KEY /
// ADMIN_DOMAIN / TENANT_BASE_DOMAIN).
const deploymentEnv: WorkflowQueueEnv & DeploymentEnv = {
  DB: noopSqlDatabaseBinding(),
  RUN_NOTIFIER: noopDurableObjectNamespace(),
  ENCRYPTION_KEY: "test-key",
  HOSTNAME_ROUTING: noopKvStoreBinding(),
  RUN_QUEUE: noopMessageQueueBinding(),
  ADMIN_DOMAIN: "admin.example.test",
  TENANT_BASE_DOMAIN: "tenant.example.test",
};

type WorkflowRunnerHandler = {
  queue(
    batch: MessageQueueBatch<unknown>,
    env: WorkflowQueueEnv & Partial<DeploymentEnv>,
  ): Promise<void>;
};

async function loadWorkflowRunner(tag: string): Promise<WorkflowRunnerHandler> {
  return (await import(
    new URL(
      `../../../runtime/queues/workflow-runner.ts?${tag}`,
      import.meta.url,
    ).href
  )).default;
}

Deno.test("workflow-runner queue handler - environment validation retries all messages when env validation fails", async () => {
  const workflowRunner = await loadWorkflowRunner("env-validation");
  const msg1 = createMessage({ test: 1 });
  const msg2 = createMessage({ test: 2 });
  const batch = createBatch("takos-workflow-jobs", [msg1, msg2]);

  // Empty env triggers the validation-failed branch.
  await workflowRunner.queue(batch, {} as WorkflowQueueEnv);

  assertSpyCalls(msg1.retry, 1);
  assertSpyCalls(msg2.retry, 1);
  assertSpyCalls(msg1.ack, 0);
  assertSpyCalls(msg2.ack, 0);
});

Deno.test("workflow-runner queue handler - takos-workflow-jobs queue acks invalid workflow messages", async () => {
  const workflowRunner = await loadWorkflowRunner("workflow-invalid");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-workflow-jobs", [msg]);

  await workflowRunner.queue(batch, minimalEnv);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - takos-workflow-jobs-dlq queue acks invalid workflow DLQ messages", async () => {
  const workflowRunner = await loadWorkflowRunner("workflow-dlq-invalid");
  const msg = createMessage({ invalid: true }, 3);
  const batch = createBatch("takos-workflow-jobs-dlq", [msg]);

  await workflowRunner.queue(batch, minimalEnv);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - takos-deployment-jobs queue acks invalid deployment messages", async () => {
  const workflowRunner = await loadWorkflowRunner("deployment-invalid");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-deployment-jobs", [msg]);

  await workflowRunner.queue(batch, deploymentEnv);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - unknown queue acks all messages", async () => {
  const workflowRunner = await loadWorkflowRunner("unknown-queue");
  const msg1 = createMessage({ test: 1 });
  const msg2 = createMessage({ test: 2 });
  const batch = createBatch("unknown-queue-name", [msg1, msg2]);

  await workflowRunner.queue(batch, minimalEnv);

  assertSpyCalls(msg1.ack, 1);
  assertSpyCalls(msg2.ack, 1);
  assertSpyCalls(msg1.retry, 0);
  assertSpyCalls(msg2.retry, 0);
});

Deno.test("workflow-runner queue handler - deployment queue accepts stage suffix in queue name", async () => {
  const workflowRunner = await loadWorkflowRunner("deployment-staging");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-deployment-jobs-staging", [msg]);

  await workflowRunner.queue(batch, deploymentEnv);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
  assertEquals(batch.queue.replace(/-staging$/i, ""), "takos-deployment-jobs");
});
