import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";

import {
  cancelWorkflowRun,
  dispatchWorkflowRun,
  rerunWorkflowRun,
} from "@/services/workflow-runs/commands";

function makeEnv(options: {
  gitObjects?: boolean;
  workflowQueue?: boolean;
  runtimeHost?: boolean;
} = {}): Env {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: options.gitObjects ? {} : undefined,
    WORKFLOW_QUEUE: options.workflowQueue
      ? { send: ((..._args: any[]) => undefined) as any }
      : undefined,
    RUNTIME_HOST: options.runtimeHost ? {} : undefined,
  } as unknown as Env;
}

Deno.test("workflow-runs commands export callable functions", () => {
  assert(typeof dispatchWorkflowRun === "function");
  assert(typeof cancelWorkflowRun === "function");
  assert(typeof rerunWorkflowRun === "function");
});

Deno.test("dispatchWorkflowRun - returns error when GIT_OBJECTS is not configured", async () => {
  const result = await dispatchWorkflowRun(makeEnv({ workflowQueue: true }), {
    repoId: "repo-1",
    workflowPath: ".takos/ci.yml",
    refName: "main",
    actorId: "user-1",
  });

  assertEquals(result.ok, false);
  assertEquals(result.status, 500);
  assertEquals(result.error, "Git storage not configured");
});

Deno.test("dispatchWorkflowRun - returns error when WORKFLOW_QUEUE is not configured", async () => {
  const result = await dispatchWorkflowRun(makeEnv({ gitObjects: true }), {
    repoId: "repo-1",
    workflowPath: ".takos/ci.yml",
    refName: "main",
    actorId: "user-1",
  });

  assertEquals(result.ok, false);
  assertEquals(result.status, 500);
  assertEquals(result.error, "Workflow queue not configured");
});
