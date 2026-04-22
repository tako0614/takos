import { assertEquals } from "jsr:@std/assert";

import {
  handleCancelledRun,
  handleFailedRun,
  handleSuccessfulRunCompletion,
  type RunLifecycleDeps,
} from "../run-lifecycle.ts";

function makeDeps(
  calls: string[],
  overrides: Partial<RunLifecycleDeps> = {},
): RunLifecycleDeps {
  return {
    updateRunStatus: async (status) => {
      calls.push(`status:${status}`);
    },
    emitEvent: async (type) => {
      calls.push(`event:${type}`);
    },
    buildTerminalEventPayload: (status, details = {}) => ({
      status,
      run: { id: "run-1", session_id: null },
      ...details,
    }),
    autoCloseSession: async (status) => {
      calls.push(`autoClose:${status}`);
    },
    enqueuePostRunJobs: async () => {
      calls.push("postRun");
    },
    sanitizeErrorMessage: (error) => `sanitized:${error}`,
    ...overrides,
  };
}

Deno.test("handleSuccessfulRunCompletion keeps success terminal when post-run jobs fail", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls, {
    enqueuePostRunJobs: async () => {
      calls.push("postRun");
      throw new Error("queue down");
    },
    autoCloseSession: async (status) => {
      calls.push(`autoClose:${status}`);
      throw new Error("close down");
    },
  });

  await handleSuccessfulRunCompletion(deps);

  assertEquals(calls, ["postRun", "autoClose:completed"]);
});

Deno.test("handleFailedRun does not retry the run when cleanup side effects fail", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls, {
    autoCloseSession: async (status) => {
      calls.push(`autoClose:${status}`);
      throw new Error("close down");
    },
    enqueuePostRunJobs: async () => {
      calls.push("postRun");
      throw new Error("queue down");
    },
  });

  await handleFailedRun(deps, "boom");

  assertEquals(calls, [
    "status:failed",
    "event:error",
    "autoClose:failed",
    "postRun",
  ]);
});

Deno.test("handleCancelledRun does not retry the run when cleanup side effects fail", async () => {
  const calls: string[] = [];
  const deps = makeDeps(calls, {
    autoCloseSession: async (status) => {
      calls.push(`autoClose:${status}`);
      throw new Error("close down");
    },
    enqueuePostRunJobs: async () => {
      calls.push("postRun");
      throw new Error("queue down");
    },
  });

  await handleCancelledRun(deps);

  assertEquals(calls, [
    "status:cancelled",
    "event:cancelled",
    "autoClose:failed",
    "postRun",
  ]);
});
