import { assertEquals } from "jsr:@std/assert";

import {
  classifyWorkerQueueName,
  normalizeWorkerQueueName,
} from "../queue-names.ts";

Deno.test("classifyWorkerQueueName accepts OSS and private queue prefixes", () => {
  assertEquals(classifyWorkerQueueName("takos-runs"), "runs");
  assertEquals(classifyWorkerQueueName("takos-runs-dlq"), "runs_dlq");
  assertEquals(classifyWorkerQueueName("takos-index-jobs"), "index_jobs");
  assertEquals(
    classifyWorkerQueueName("takos-index-jobs-dlq"),
    "index_jobs_dlq",
  );
  assertEquals(classifyWorkerQueueName("takos-workflow-jobs"), "workflow_jobs");
  assertEquals(
    classifyWorkerQueueName("takos-workflow-jobs-dlq"),
    "workflow_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-deployment-jobs"),
    "deployment_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-deployment-jobs-dlq"),
    "deployment_jobs_dlq",
  );

  assertEquals(classifyWorkerQueueName("takos-private-runs"), "runs");
  assertEquals(classifyWorkerQueueName("takos-private-runs-dlq"), "runs_dlq");
  assertEquals(
    classifyWorkerQueueName("takos-private-index-jobs"),
    "index_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-index-jobs-dlq"),
    "index_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-workflow-jobs"),
    "workflow_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-workflow-jobs-dlq"),
    "workflow_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-deployment-jobs"),
    "deployment_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-deployment-jobs-dlq"),
    "deployment_jobs_dlq",
  );
});

Deno.test("classifyWorkerQueueName strips staging suffix after dlq suffix", () => {
  assertEquals(
    normalizeWorkerQueueName("takos-private-deployment-jobs-dlq-staging"),
    "takos-private-deployment-jobs-dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-deployment-jobs-staging"),
    "deployment_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-deployment-jobs-dlq-staging"),
    "deployment_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-workflow-jobs-staging"),
    "workflow_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-private-runs-dlq-staging"),
    "runs_dlq",
  );
});

Deno.test("classifyWorkerQueueName rejects unrelated queues", () => {
  assertEquals(classifyWorkerQueueName("mail-jobs"), null);
  assertEquals(classifyWorkerQueueName("takos-deployment-jobs-preview"), null);
});
