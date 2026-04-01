import type { D1Database } from "@cloudflare/workers-types";

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

import {
  RUNTIME_EXEC,
  RUNTIME_STATUS,
  RUNTIME_TOOLS,
  runtimeExecHandler,
  runtimeStatusHandler,
} from "@/tools/builtin/runtime";
import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    sessionId: undefined,
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: () => undefined,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: () => undefined,
    ...overrides,
  };
}

Deno.test("runtime tools export both runtime definitions", () => {
  assertEquals(RUNTIME_EXEC.name, "runtime_exec");
  assertEquals(RUNTIME_EXEC.category, "runtime");
  assertEquals(RUNTIME_EXEC.parameters.required, ["commands"]);
  assertEquals(RUNTIME_STATUS.name, "runtime_status");
  assertEquals(RUNTIME_STATUS.parameters.required, ["runtime_id"]);
  assertEquals(RUNTIME_TOOLS.map((tool) => tool.name), [
    "runtime_exec",
    "runtime_status",
  ]);
});

Deno.test("runtimeExecHandler rejects empty command arrays", async () => {
  await assertRejects(
    () => runtimeExecHandler({ commands: [] }, makeContext()),
    Error,
    "Commands must be a non-empty array",
  );
});

Deno.test("runtimeExecHandler rejects dangerous commands", async () => {
  await assertRejects(
    () => runtimeExecHandler({ commands: ["rm -rf /"] }, makeContext()),
    Error,
    "Dangerous command pattern detected",
  );
});

Deno.test("runtimeExecHandler rejects path traversal in working_dir", async () => {
  await assertRejects(
    () =>
      runtimeExecHandler(
        { commands: ["echo hello"], working_dir: "../secret" },
        makeContext(),
      ),
    Error,
    "path traversal not allowed",
  );
});

Deno.test("runtimeExecHandler fails fast when no container session is available", async () => {
  const error = await assertRejects(
    () =>
      runtimeExecHandler(
        { commands: ["echo hello"] },
        makeContext({
          env: { RUNTIME_HOST: "runtime.example.internal" } as unknown as Env,
        }),
      ),
  );

  assertStringIncludes(
    error instanceof Error ? error.message : String(error),
    "container",
  );
});

Deno.test("runtimeStatusHandler requires the runtime host binding", async () => {
  await assertRejects(
    () => runtimeStatusHandler({ runtime_id: "rt-1" }, makeContext()),
    Error,
    "RUNTIME_HOST binding is required",
  );
});
