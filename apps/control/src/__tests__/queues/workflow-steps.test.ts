import { assert, assertEquals } from "jsr:@std/assert";

import { executeStep } from "@/queues/workflow-steps";
import type { StepExecutionContext } from "@/queues/workflow-types";

type FetchCall = {
  request: Request;
};

function createFetchRecorder(
  responder: (request: Request) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];

  const fetch = async (request: Request) => {
    calls.push({ request });
    return responder(request);
  };

  return { calls, fetch };
}

function createContext(
  overrides: Partial<StepExecutionContext> = {},
): StepExecutionContext {
  return {
    env: {
      RUNTIME_HOST: { fetch: async () => new Response(null) },
    } as any,
    jobId: "job-1",
    stepNumber: 1,
    spaceId: "space-1",
    ...overrides,
  };
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("executeStep - returns success for a no-op step", async () => {
  const result = await executeStep({}, createContext());

  assertEquals(result.success, true);
  assertEquals(result.stdout, "No action to perform");
  assertEquals(result.outputs, {});
});

Deno.test("executeStep - returns failure when RUNTIME_HOST is not configured", async () => {
  const result = await executeStep(
    { run: "echo test" },
    createContext({
      env: {} as any,
    }),
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "RUNTIME_HOST binding is required");
});

Deno.test("executeStep - executes a run step via runtime", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 0,
      stdout: "hello world",
      stderr: "",
      outputs: { result: "ok" },
      conclusion: "success",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  const result = await executeStep({ run: "echo hello" }, ctx);

  assertEquals(result.success, true);
  assertEquals(result.exitCode, 0);
  assertEquals(result.stdout, "hello world");
  assertEquals(result.outputs, { result: "ok" });
  assertEquals(result.error, undefined);
  assertEquals(recorder.calls.length, 1);
});

Deno.test("executeStep - executes a uses step via runtime", async () => {
  const recorder = createFetchRecorder((request) => {
    assertEquals(request.url, "https://runtime-host/actions/jobs/job-1/step/1");
    assertEquals(request.method, "POST");
    return createJsonResponse({
      exitCode: 0,
      stdout: "action output",
      stderr: "",
      outputs: {},
      conclusion: "success",
    });
  });
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  const result = await executeStep({
    uses: "actions/checkout@v4",
    with: { fetch_depth: 1 },
  }, ctx);

  assertEquals(result.success, true);
  assertEquals(recorder.calls.length, 1);
  const body = (await recorder.calls[0].request.clone().json()) as Record<
    string,
    unknown
  >;
  assertEquals(body, {
    uses: "actions/checkout@v4",
    with: { fetch_depth: 1 },
    space_id: "space-1",
  });
});

Deno.test("executeStep - returns failure when runtime reports failure", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 1,
      stdout: "",
      stderr: "command not found",
      outputs: {},
      conclusion: "failure",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  const result = await executeStep({ run: "invalid-command" }, ctx);

  assertEquals(result.success, false);
  assertEquals(result.exitCode, 1);
  assertEquals(result.error, "command not found");
});

Deno.test("executeStep - uses Step failed when stderr is empty", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 1,
      stdout: "",
      stderr: "",
      outputs: {},
      conclusion: "failure",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  const result = await executeStep({ run: "false" }, ctx);

  assertEquals(result.success, false);
  assertEquals(result.error, "Step failed");
});

Deno.test("executeStep - passes shell and working-directory to runtime", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      outputs: {},
      conclusion: "success",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
    shell: "bash",
    workingDirectory: "/app",
  });

  await executeStep({ run: "echo test" }, ctx);

  const body = (await recorder.calls[0].request.clone().json()) as Record<
    string,
    unknown
  >;
  assertEquals(body.shell, "bash");
  assertEquals(body["working-directory"], "/app");
});

Deno.test("executeStep - passes step metadata to runtime", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 0,
      stdout: "",
      stderr: "",
      outputs: {},
      conclusion: "success",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  await executeStep({
    run: "echo test",
    name: "My Step",
    env: { NODE_ENV: "test" },
    "continue-on-error": true,
    "timeout-minutes": 10,
  }, ctx);

  const body = (await recorder.calls[0].request.clone().json()) as Record<
    string,
    unknown
  >;
  assertEquals(body.name, "My Step");
  assertEquals(body.env, { NODE_ENV: "test" });
  assertEquals(body["continue-on-error"], true);
  assertEquals(body["timeout-minutes"], 10);
});

Deno.test("executeStep - handles missing outputs in response", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      conclusion: "success",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
  });

  const result = await executeStep({ run: "echo done" }, ctx);

  assertEquals(result.success, true);
  assertEquals(result.outputs, {});
});

Deno.test("executeStep - uses the configured step number in the endpoint", async () => {
  const recorder = createFetchRecorder(() =>
    createJsonResponse({
      exitCode: 0,
      stdout: "",
      stderr: "",
      outputs: {},
      conclusion: "success",
    })
  );
  const ctx = createContext({
    env: { RUNTIME_HOST: { fetch: recorder.fetch } } as any,
    stepNumber: 5,
    jobId: "job-42",
  });

  await executeStep({ run: "echo test" }, ctx);

  assertEquals(
    recorder.calls[0].request.url,
    "https://runtime-host/actions/jobs/job-42/step/5",
  );
  assert(recorder.calls.length > 0);
});
