import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  classifyWorkerQueueName,
  normalizeWorkerQueueName,
} from "../queue-names.ts";

test("classifyWorkerQueueName accepts OSS and private queue prefixes", () => {
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
  assertEquals(
    classifyWorkerQueueName("takos-notification-push"),
    "notification_push",
  );
  assertEquals(
    classifyWorkerQueueName("takos-notification-push-dlq"),
    "notification_push_dlq",
  );

  assertEquals(classifyWorkerQueueName("takos-selfhost-runs"), "runs");
  assertEquals(classifyWorkerQueueName("takos-selfhost-runs-dlq"), "runs_dlq");
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-index-jobs"),
    "index_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-index-jobs-dlq"),
    "index_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-workflow-jobs"),
    "workflow_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-workflow-jobs-dlq"),
    "workflow_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-deployment-jobs"),
    "deployment_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-deployment-jobs-dlq"),
    "deployment_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-notification-push"),
    "notification_push",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-notification-push-dlq"),
    "notification_push_dlq",
  );
});

test("classifyWorkerQueueName strips staging suffix after dlq suffix", () => {
  assertEquals(
    normalizeWorkerQueueName("takos-selfhost-deployment-jobs-dlq-staging"),
    "takos-selfhost-deployment-jobs-dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-deployment-jobs-staging"),
    "deployment_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-deployment-jobs-dlq-staging"),
    "deployment_jobs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-workflow-jobs-staging"),
    "workflow_jobs",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-runs-dlq-staging"),
    "runs_dlq",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-notification-push-staging"),
    "notification_push",
  );
  assertEquals(
    classifyWorkerQueueName("takos-selfhost-notification-push-dlq-staging"),
    "notification_push_dlq",
  );
});

test("classifyWorkerQueueName rejects unrelated queues", () => {
  assertEquals(classifyWorkerQueueName("mail-jobs"), null);
  assertEquals(classifyWorkerQueueName("takos-deployment-jobs-preview"), null);
});
