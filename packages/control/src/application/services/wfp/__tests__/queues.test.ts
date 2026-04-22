import { assertEquals } from "jsr:@std/assert";

import {
  deleteQueueConsumerByQueueName,
  upsertQueueConsumerByQueueName,
} from "../queues.ts";
import type { WfpContext } from "../wfp-contracts.ts";

function createFakeContext(): {
  ctx: WfpContext;
  requests: Array<{ path: string; options?: RequestInit }>;
} {
  const requests: Array<{ path: string; options?: RequestInit }> = [];
  const ctx: WfpContext = {
    config: {
      accountId: "account-1",
      apiToken: "token-1",
      dispatchNamespace: "dispatch-namespace",
    },
    scriptPath(workerName: string): string {
      return `/accounts/account-1/workers/dispatch/namespaces/dispatch-namespace/scripts/${workerName}`;
    },
    accountPath(suffix: string): string {
      return `/accounts/account-1${suffix}`;
    },
    async cfFetch<T>(path: string, options?: RequestInit) {
      requests.push({ path, options });
      if (path === "/accounts/account-1/queues") {
        return {
          success: true,
          errors: [],
          messages: [],
          result: [{ queue_id: "queue-1", queue_name: "jobs" }],
        } as never;
      }
      if (path === "/accounts/account-1/queues/queue-1/consumers") {
        return {
          success: true,
          errors: [],
          messages: [],
          result: [{
            consumer_id: "consumer-1",
            queue_name: "jobs",
            script_name: "old-worker",
            type: "worker",
          }],
        } as never;
      }
      throw new Error(`unexpected cfFetch path: ${path}`);
    },
    async cfFetchWithRetry<T>(path: string, options?: RequestInit) {
      requests.push({ path, options });
      return {
        success: true,
        errors: [],
        messages: [],
        result: {
          consumer_id: "consumer-1",
          queue_name: "jobs",
          script_name: "new-worker",
          type: "worker",
        },
      } as never;
    },
    formatBinding(binding) {
      return { ...binding };
    },
    formatBindingForUpdate(binding) {
      return { ...binding };
    },
  };

  return { ctx, requests };
}

Deno.test("upsertQueueConsumerByQueueName updates the requested replacement consumer", async () => {
  const { ctx, requests } = createFakeContext();

  await upsertQueueConsumerByQueueName(ctx, "jobs", {
    scriptName: "new-worker",
    replaceScriptName: "old-worker",
    deadLetterQueue: "jobs-dlq",
    settings: {
      batch_size: 10,
      max_retries: 3,
    },
  });

  assertEquals(requests.map((request) => request.path), [
    "/accounts/account-1/queues",
    "/accounts/account-1/queues/queue-1/consumers",
    "/accounts/account-1/queues/queue-1/consumers/consumer-1",
  ]);
  const updateRequest = requests[2]!.options!;
  assertEquals(updateRequest.method, "PUT");
  assertEquals(JSON.parse(String(updateRequest.body)), {
    type: "worker",
    script_name: "new-worker",
    dead_letter_queue: "jobs-dlq",
    settings: {
      batch_size: 10,
      max_retries: 3,
    },
  });
});

Deno.test("upsertQueueConsumerByQueueName does not replace unrelated existing consumers", async () => {
  const { ctx, requests } = createFakeContext();

  await upsertQueueConsumerByQueueName(ctx, "jobs", {
    scriptName: "new-worker",
  });

  assertEquals(requests.map((request) => request.path), [
    "/accounts/account-1/queues",
    "/accounts/account-1/queues/queue-1/consumers",
    "/accounts/account-1/queues/queue-1/consumers",
  ]);
  const createRequest = requests[2]!.options!;
  assertEquals(createRequest.method, "POST");
  assertEquals(JSON.parse(String(createRequest.body)), {
    type: "worker",
    script_name: "new-worker",
  });
});

Deno.test("deleteQueueConsumerByQueueName deletes the matching script consumer", async () => {
  const { ctx, requests } = createFakeContext();

  const deleted = await deleteQueueConsumerByQueueName(ctx, "jobs", {
    scriptName: "old-worker",
  });

  assertEquals(deleted, 1);
  assertEquals(requests.map((request) => request.path), [
    "/accounts/account-1/queues",
    "/accounts/account-1/queues/queue-1/consumers",
    "/accounts/account-1/queues/queue-1/consumers/consumer-1",
  ]);
  assertEquals(requests[2]!.options?.method, "DELETE");
});
