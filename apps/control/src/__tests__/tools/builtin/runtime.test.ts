import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/usage-client'
import {
  RUNTIME_EXEC,
  RUNTIME_STATUS,
  RUNTIME_TOOLS,
  runtimeExecHandler,
  runtimeStatusHandler,
} from "@/tools/builtin/runtime";
import { callRuntimeRequest } from "@/services/execution/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    sessionId: "session-1",
    env: { RUNTIME_HOST: "runtime.example.internal" } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("runtime tools - RUNTIME_EXEC definition - has correct name and required params", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(RUNTIME_EXEC.name, "runtime_exec");
  assertEquals(RUNTIME_EXEC.category, "runtime");
  assertEquals(RUNTIME_EXEC.parameters.required, ["commands"]);
});

Deno.test("runtime tools - RUNTIME_STATUS definition - has correct name and required params", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(RUNTIME_STATUS.name, "runtime_status");
  assertEquals(RUNTIME_STATUS.parameters.required, ["runtime_id"]);
});

Deno.test("runtime tools - RUNTIME_TOOLS - exports both runtime tools", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(RUNTIME_TOOLS.length, 2);
  assertEquals(RUNTIME_TOOLS.map((t) => t.name), [
    "runtime_exec",
    "runtime_status",
  ]);
});

Deno.test("runtime tools - runtimeExecHandler - executes commands successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () =>
    mockResponse({
      success: true,
      exit_code: 0,
      output: "hello world",
    })) as any;

  const result = await runtimeExecHandler(
    { commands: ["echo hello"] },
    makeContext(),
  );

  assertStringIncludes(result, "Commands completed successfully");
  assertStringIncludes(result, "hello world");
});
Deno.test("runtime tools - runtimeExecHandler - returns failure output when command fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () =>
    mockResponse({
      success: false,
      exit_code: 1,
      output: "error output",
    })) as any;

  const result = await runtimeExecHandler(
    { commands: ["false"] },
    makeContext(),
  );

  assertStringIncludes(result, "Commands failed");
  assertStringIncludes(result, "exit code 1");
  assertStringIncludes(result, "error output");
});
Deno.test("runtime tools - runtimeExecHandler - throws when RUNTIME_HOST is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["echo hi"] },
      makeContext({ env: {} as Env }),
    );
  }, "RUNTIME_HOST binding is required");
});
Deno.test("runtime tools - runtimeExecHandler - throws when no container session is active", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["echo hi"] },
      makeContext({ sessionId: undefined }),
    );
  }, /container/i);
});
Deno.test("runtime tools - runtimeExecHandler - throws on runtime error response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest =
    (async () =>
      mockResponse({ error: "Service unavailable" }, false, 503)) as any;

  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["echo hi"] },
      makeContext(),
    );
  }, "Service unavailable");
});
// Validation tests
Deno.test("runtime tools - runtimeExecHandler - rejects empty commands array", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler({ commands: [] }, makeContext());
  }, "non-empty array");
});
Deno.test("runtime tools - runtimeExecHandler - rejects non-string commands", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler({ commands: ["valid", ""] }, makeContext());
  }, "non-empty string");
});
Deno.test("runtime tools - runtimeExecHandler - rejects path traversal in working_dir", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["ls"], working_dir: "../etc" },
      makeContext(),
    );
  }, "path traversal");
});
Deno.test("runtime tools - runtimeExecHandler - rejects null bytes in working_dir", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["ls"], working_dir: "foo\0bar" },
      makeContext(),
    );
  }, "null bytes");
});
Deno.test("runtime tools - runtimeExecHandler - rejects dangerous commands like fork bombs", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: [":(){ :|:& }"] },
      makeContext(),
    );
  }, "Dangerous command");
});
Deno.test("runtime tools - runtimeExecHandler - rejects reboot commands", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["reboot"] },
      makeContext(),
    );
  }, "Dangerous command");
});
Deno.test("runtime tools - runtimeExecHandler - rejects shutdown commands", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeExecHandler(
      { commands: ["shutdown -h now"] },
      makeContext(),
    );
  }, "Dangerous command");
});
Deno.test("runtime tools - runtimeExecHandler - clamps timeout to max of 1800", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest =
    (async () =>
      mockResponse({ success: true, exit_code: 0, output: "ok" })) as any;

  await runtimeExecHandler(
    { commands: ["echo hi"], timeout: 99999 },
    makeContext(),
  );

  assertSpyCallArgs(callRuntimeRequest, 0, [
    expect.anything(),
    "/session/exec",
    {
      body: {
        timeout: 1800,
      },
    },
  ]);
});

Deno.test("runtime tools - runtimeStatusHandler - returns runtime status when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () =>
    mockResponse({
      runtime_id: "rt-1",
      status: "completed",
      exit_code: 0,
      output: "done",
    })) as any;

  const result = await runtimeStatusHandler(
    { runtime_id: "rt-1" },
    makeContext(),
  );

  assertStringIncludes(result, "Runtime: rt-1");
  assertStringIncludes(result, "Status: completed");
  assertStringIncludes(result, "Exit Code: 0");
  assertStringIncludes(result, "done");
});
Deno.test("runtime tools - runtimeStatusHandler - returns not found for 404", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () => mockResponse({}, false, 404)) as any;

  const result = await runtimeStatusHandler(
    { runtime_id: "missing" },
    makeContext(),
  );

  assertStringIncludes(result, "not found: missing");
});
Deno.test("runtime tools - runtimeStatusHandler - throws when RUNTIME_HOST is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertRejects(async () => {
    await runtimeStatusHandler(
      { runtime_id: "rt-1" },
      makeContext({ env: {} as Env }),
    );
  }, "RUNTIME_HOST binding is required");
});
Deno.test("runtime tools - runtimeStatusHandler - throws on error responses", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () => ({
    ok: false,
    status: 500,
    text: async () => "Internal Server Error",
  } as unknown as Response)) as any;

  await assertRejects(async () => {
    await runtimeStatusHandler({ runtime_id: "rt-1" }, makeContext());
  }, "Failed to get status");
});
Deno.test("runtime tools - runtimeStatusHandler - includes error output in status text", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  callRuntimeRequest = (async () =>
    mockResponse({
      runtime_id: "rt-1",
      status: "failed",
      error: "OOM killed",
    })) as any;

  const result = await runtimeStatusHandler(
    { runtime_id: "rt-1" },
    makeContext(),
  );

  assertStringIncludes(result, "OOM killed");
});
