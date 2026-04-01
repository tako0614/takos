import { assert, assertEquals } from "jsr:@std/assert";

import {
  handleCancelledRun,
  handleFailedRun,
  handleSuccessfulRunCompletion,
  RunCancelledError,
  type RunLifecycleDeps,
  shouldResetRunToQueuedOnContainerError,
} from "../../../../../../packages/control/src/application/services/agent/run-lifecycle.ts";

function createDeps() {
  const callLog: string[] = [];
  const updateRunStatusCalls: Array<
    [string, string | undefined, string | undefined]
  > = [];
  const emitEventCalls: Array<[string, Record<string, unknown>]> = [];
  const autoCloseSessionCalls: string[] = [];
  const enqueueCalls: string[] = [];
  const sanitizedInputs: string[] = [];

  const deps: RunLifecycleDeps = {
    updateRunStatus: async (status, output, error) => {
      callLog.push(`update:${status}`);
      updateRunStatusCalls.push([status, output, error]);
    },
    emitEvent: async (type, data) => {
      callLog.push(`emit:${type}`);
      emitEventCalls.push([type, data]);
    },
    buildTerminalEventPayload: (status, details = {}) =>
      ({
        run: { id: "run-1", status, ...details },
      }) as never,
    autoCloseSession: async (status) => {
      callLog.push(`close:${status}`);
      autoCloseSessionCalls.push(status);
    },
    enqueuePostRunJobs: async () => {
      callLog.push("enqueue");
      enqueueCalls.push("enqueue");
    },
    sanitizeErrorMessage: (error) => {
      sanitizedInputs.push(error);
      return `sanitized:${error}`;
    },
  };

  return {
    deps,
    callLog,
    updateRunStatusCalls,
    emitEventCalls,
    autoCloseSessionCalls,
    enqueueCalls,
    sanitizedInputs,
  };
}

Deno.test("run lifecycle - exposes cancellation policy helpers", () => {
  const err = new RunCancelledError();
  assertEquals(err.name, "RunCancelledError");
  assertEquals(err.message, "Run cancelled");
  assert(err instanceof Error);

  assertEquals(shouldResetRunToQueuedOnContainerError("running"), true);
  assertEquals(shouldResetRunToQueuedOnContainerError("queued"), false);
  assertEquals(shouldResetRunToQueuedOnContainerError(null), false);
});

Deno.test("run lifecycle - successful completion enqueues jobs before closing", async () => {
  const ctx = createDeps();
  await handleSuccessfulRunCompletion(ctx.deps);

  assertEquals(ctx.callLog, ["enqueue", "close:completed"]);
  assertEquals(ctx.enqueueCalls, ["enqueue"]);
  assertEquals(ctx.autoCloseSessionCalls, ["completed"]);
});

Deno.test("run lifecycle - cancelled run updates, emits, closes, then enqueues", async () => {
  const ctx = createDeps();
  await handleCancelledRun(ctx.deps);

  assertEquals(ctx.callLog, [
    "update:cancelled",
    "emit:cancelled",
    "close:failed",
    "enqueue",
  ]);
  assertEquals(ctx.updateRunStatusCalls[0], [
    "cancelled",
    undefined,
    "Run cancelled",
  ]);
  assertEquals(ctx.emitEventCalls[0][0], "cancelled");
  assertEquals(
    (ctx.emitEventCalls[0][1].run as { status: string }).status,
    "cancelled",
  );
});

Deno.test("run lifecycle - failed run sanitizes the error and emits the terminal payload", async () => {
  const ctx = createDeps();
  await handleFailedRun(ctx.deps, new Error("boom"));

  assertEquals(ctx.sanitizedInputs, ["Error: boom"]);
  assertEquals(ctx.updateRunStatusCalls[0], [
    "failed",
    undefined,
    "sanitized:Error: boom",
  ]);
  assertEquals(ctx.emitEventCalls[0][0], "error");
  assertEquals(
    (ctx.emitEventCalls[0][1].run as { status: string; error: string }).status,
    "failed",
  );
  assertEquals(
    (ctx.emitEventCalls[0][1].run as { status: string; error: string }).error,
    "sanitized:Error: boom",
  );
  assertEquals(ctx.callLog, [
    "update:failed",
    "emit:error",
    "close:failed",
    "enqueue",
  ]);
});

Deno.test("run lifecycle - converts non-error values to strings", async () => {
  const ctx = createDeps();
  await handleFailedRun(ctx.deps, { code: 500, message: "internal" });

  assertEquals(ctx.sanitizedInputs, ["[object Object]"]);
  assertEquals(ctx.updateRunStatusCalls[0][2], "sanitized:[object Object]");
});
