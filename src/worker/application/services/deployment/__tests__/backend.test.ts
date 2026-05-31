import { assertEquals, assertObjectMatch, assertRejects } from "@std/assert";
import { spy } from "@std/testing/mock";

import {
  createDeploymentBackend,
  createOciDeploymentBackend,
  createRuntimeHostDeploymentBackend,
  createWorkersDispatchDeploymentBackend,
} from "../backend.ts";
import type { Deployment } from "../models.ts";

Deno.test("OCI deployment backend forwards runtime env vars and cleans up deployed artifacts", async () => {
  const fetchSpy = spy(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(_input).endsWith("/deploy")) {
        return new Response(
          JSON.stringify({
            resolved_endpoint: {
              kind: "http-url",
              base_url: "https://candidate.example.test",
            },
            logs_ref: "/var/log/takos/worker.log",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (
        init?.method === "POST" && String(_input).includes("/remove?space_id=")
      ) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${String(_input)}`);
    },
  );
  const fetchImpl = fetchSpy as unknown as typeof fetch;

  const backend = createOciDeploymentBackend(
    {
      backend_name: "oci",
      space_id: "space-1",
      target_json: JSON.stringify({
        route_ref: "worker",
        endpoint: {
          kind: "service-ref",
          ref: "worker",
        },
        artifact: {
          kind: "container-image",
          image_ref: "ghcr.io/takos/worker:latest",
          exposed_port: 8080,
          health_path: "/readyz",
          health_interval: 5,
          health_timeout: 30,
          health_unhealthy_threshold: 3,
        },
      }),
    },
    {
      orchestratorUrl: "https://oci.example.test",
      orchestratorToken: "secret-token",
      fetchImpl,
    },
  );

  const deployment = {
    id: "dep-1",
    space_id: "space-1",
  } as Deployment;

  const controller = new AbortController();
  const result = await backend.deploy({
    deployment,
    artifactRef: "worker-v1",
    wasmContent: null,
    runtime: {
      profile: "container-service",
      envVars: {
        DATABASE_URL: "postgres://db.internal/takos",
        API_TOKEN: "secret-value",
      },
      bindings: [],
      config: {
        compatibility_date: "2026-01-01",
        compatibility_flags: ["nodejs_compat"],
        limits: { cpu_ms: 50 },
      },
    },
    signal: controller.signal,
  });

  assertEquals(result, {
    resolvedEndpoint: {
      kind: "http-url",
      base_url: "https://candidate.example.test",
    },
    logsRef: "/var/log/takos/worker.log",
  });

  const deployCall = fetchSpy.calls[0]!;
  assertEquals(deployCall.args[0], "https://oci.example.test/deploy");
  const deployRequest = deployCall.args[1] as RequestInit;
  const deployBody = JSON.parse(String(deployRequest.body)) as Record<
    string,
    unknown
  >;
  assertObjectMatch(deployBody, {
    deployment_id: "dep-1",
    space_id: "space-1",
    artifact_ref: "worker-v1",
  });
  assertObjectMatch(deployBody.runtime as Record<string, unknown>, {
    profile: "container-service",
    env_vars: {
      DATABASE_URL: "postgres://db.internal/takos",
      API_TOKEN: "secret-value",
    },
  });
  assertObjectMatch(deployBody.target as Record<string, unknown>, {
    route_ref: "worker",
  });
  assertEquals(deployRequest.signal, controller.signal);

  await backend.cleanupDeploymentArtifact?.("worker-v1");
  const cleanupCall = fetchSpy.calls[1]!;
  assertEquals(
    cleanupCall.args[0],
    "https://oci.example.test/services/worker/remove?space_id=space-1",
  );
  assertEquals((cleanupCall.args[1] as RequestInit).method, "POST");
});

Deno.test("OCI deployment backend rejects pre-aborted signals before fetch", async () => {
  const fetchSpy = spy(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const backend = createOciDeploymentBackend(
    {
      backend_name: "oci",
      space_id: "space-1",
      target_json: JSON.stringify({
        route_ref: "worker",
        artifact: {
          kind: "container-image",
          image_ref: "ghcr.io/takos/worker:latest",
        },
      }),
    },
    {
      orchestratorUrl: "https://oci.example.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    },
  );

  const controller = new AbortController();
  controller.abort("cancelled-deploy");

  await assertRejects(
    () =>
      backend.deploy({
        deployment: { id: "dep-1", space_id: "space-1" } as Deployment,
        artifactRef: "worker-v1",
        wasmContent: null,
        runtime: {
          profile: "container-service",
          envVars: {},
          bindings: [],
        },
        signal: controller.signal,
      }),
    Error,
    "cancelled-deploy (oci-deploy)",
  );
  assertEquals(fetchSpy.calls.length, 0);
});

Deno.test("OCI deployment backend aborts an in-flight fetch when the signal fires mid-call", async () => {
  // Force the orchestrator fetch to block until the test triggers abort.
  // The real fetch implementation honors `signal` and rejects with
  // AbortError; we model the same shape so the test exercises the path the
  // pipeline would see in production.
  const fetchCalls: Array<{ url: string; signal: AbortSignal | undefined }> =
    [];
  const fetchImpl: typeof fetch = (input, init) => {
    fetchCalls.push({
      url: String(input),
      signal: (init as RequestInit | undefined)?.signal ?? undefined,
    });
    return new Promise<Response>((_, reject) => {
      const sig = (init as RequestInit | undefined)?.signal;
      if (!sig) return; // never resolves — caller must fail another way
      const onAbort = () => {
        const reason = sig.reason;
        const err = reason instanceof Error ? reason : new DOMException(
          typeof reason === "string" ? reason : "aborted",
          "AbortError",
        );
        reject(err);
      };
      if (sig.aborted) {
        onAbort();
        return;
      }
      sig.addEventListener("abort", onAbort, { once: true });
    });
  };

  const backend = createOciDeploymentBackend(
    {
      backend_name: "oci",
      space_id: "space-1",
      target_json: JSON.stringify({
        route_ref: "worker",
        artifact: {
          kind: "container-image",
          image_ref: "ghcr.io/takos/worker:latest",
        },
      }),
    },
    {
      orchestratorUrl: "https://oci.example.test",
      fetchImpl,
    },
  );

  const controller = new AbortController();
  const pending = backend.deploy({
    deployment: { id: "dep-mid", space_id: "space-1" } as Deployment,
    artifactRef: "worker-mid",
    wasmContent: null,
    runtime: {
      profile: "container-service",
      envVars: {},
      bindings: [],
    },
    signal: controller.signal,
  });

  // Wait one microtask so the fetch is in flight before we abort.
  await Promise.resolve();
  controller.abort("user-cancelled-mid-flight");

  await assertRejects(
    () => pending,
    Error,
    "user-cancelled-mid-flight",
  );
  // The driver issued exactly one fetch and that fetch saw the signal.
  assertEquals(fetchCalls.length, 1);
  assertEquals(fetchCalls[0]?.signal, controller.signal);
});

Deno.test("createDeploymentBackend rejects unknown deployment backend names", async () => {
  await assertRejects(
    async () => {
      createDeploymentBackend(
        {
          backend_name: "cloudflare",
          space_id: "space-1",
          target_json: "{}",
        } as unknown as Deployment,
      );
    },
    Error,
    "Unknown deployment backend: cloudflare",
  );
});

Deno.test("runtime-host backend rejects pre-aborted signals before validation", async () => {
  const backend = createRuntimeHostDeploymentBackend();
  const controller = new AbortController();
  controller.abort("cancelled-runtime-host");

  await assertRejects(
    () =>
      backend.deploy({
        deployment: { id: "dep-1", space_id: "space-1" } as Deployment,
        artifactRef: "app-web-v1",
        bundleContent: "export default {}",
        wasmContent: null,
        runtime: { profile: "workers", bindings: [], envVars: {} },
        signal: controller.signal,
      }),
    Error,
    "cancelled-runtime-host (runtime-host-deploy)",
  );
});

Deno.test("workers-dispatch backend upserts declared message queue consumers", async () => {
  const workerCalls: unknown[] = [];
  const queueCalls: Array<{
    action?: string;
    queueName: string;
    input: unknown;
    options?: { signal?: AbortSignal };
  }> = [];
  const backend = createWorkersDispatchDeploymentBackend({
    workers: {
      createWorker(options: unknown) {
        workerCalls.push(options);
        return Promise.resolve();
      },
    },
    queues: {
      upsertQueueConsumerByQueueName(
        queueName: string,
        input: unknown,
        options?: { signal?: AbortSignal },
      ) {
        queueCalls.push({ queueName, input, options });
        return Promise.resolve({ id: "consumer-1", queueName });
      },
      deleteQueueConsumerByQueueName(
        queueName: string,
        input: unknown,
        options?: { signal?: AbortSignal },
      ) {
        queueCalls.push({ queueName, input, action: "delete" });
        return Promise.resolve(1);
      },
    },
  } as never);

  const deployment = {
    id: "dep-1",
    space_id: "space-1",
    target_json: JSON.stringify({
      queue_consumers: [{
        binding: "DELIVERY_QUEUE",
        dead_letter_queue: "DELIVERY_DLQ",
        settings: {
          batch_size: 10,
          max_retries: 3,
        },
      }],
    }),
  } as Deployment;

  const runtime = {
    profile: "workers" as const,
    bindings: [
      {
        type: "queue" as const,
        name: "DELIVERY_QUEUE",
        queue_name: "yurucommu-delivery",
      },
      {
        type: "queue" as const,
        name: "DELIVERY_DLQ",
        queue_name: "yurucommu-delivery-dlq",
      },
    ],
  };

  await backend.deploy({
    deployment,
    artifactRef: "app-web-v1",
    bundleContent: "export default {}",
    wasmContent: null,
    runtime,
  });

  assertEquals(workerCalls.length, 1);
  assertEquals(queueCalls, []);

  const controller = new AbortController();
  await backend.syncQueueConsumers?.({
    deployment,
    artifactRef: "app-web-v1",
    runtime,
    signal: controller.signal,
  });

  assertEquals(queueCalls.length, 1);
  assertEquals(queueCalls[0]?.options?.signal === controller.signal, true);
  assertEquals(queueCalls.map(({ options: _options, ...call }) => call), [{
    queueName: "yurucommu-delivery",
    input: {
      scriptName: "app-web-v1",
      deadLetterQueue: "yurucommu-delivery-dlq",
      settings: {
        batch_size: 10,
        max_retries: 3,
      },
    },
  }]);
});

Deno.test("workers-dispatch backend rejects pre-aborted signals before upload", async () => {
  const workerCalls: unknown[] = [];
  const backend = createWorkersDispatchDeploymentBackend({
    workers: {
      createWorker(options: unknown) {
        workerCalls.push(options);
        return Promise.resolve();
      },
    },
    queues: {},
  } as never);
  const controller = new AbortController();
  controller.abort("cancelled-workers-dispatch");

  await assertRejects(
    () =>
      backend.deploy({
        deployment: {
          id: "dep-1",
          space_id: "space-1",
          target_json: "{}",
        } as Deployment,
        artifactRef: "app-web-v1",
        bundleContent: "export default {}",
        wasmContent: null,
        runtime: { profile: "workers", bindings: [] },
        signal: controller.signal,
      }),
    Error,
    "cancelled-workers-dispatch (workers-dispatch-deploy)",
  );
  assertEquals(workerCalls.length, 0);
});

Deno.test(
  "workers-dispatch backend rejects with caller reason when signal aborts mid-deploy",
  async () => {
    let resolveWorker: (() => void) | undefined;
    const workerCalls: unknown[] = [];
    // createWorker stays pending until the test resolves it - mirrors the
    // pre-fix scenario where the wfp HTTP request was already in flight.
    const backend = createWorkersDispatchDeploymentBackend({
      workers: {
        createWorker(options: unknown) {
          workerCalls.push(options);
          return new Promise<void>((resolve) => {
            resolveWorker = resolve;
          });
        },
      },
      queues: {},
    } as never);
    const controller = new AbortController();
    const pending = backend.deploy({
      deployment: {
        id: "dep-mid",
        space_id: "space-1",
        target_json: "{}",
      } as Deployment,
      artifactRef: "app-web-v2",
      bundleContent: "export default {}",
      wasmContent: null,
      runtime: { profile: "workers", bindings: [] },
      signal: controller.signal,
    });

    // Abort after the wfp call has started but before it resolves.
    queueMicrotask(() =>
      controller.abort(new Error("deploy-cancelled-mid-flight"))
    );

    await assertRejects(
      async () => await pending,
      Error,
      "deploy-cancelled-mid-flight",
    );
    assertEquals(workerCalls.length, 1);
    // Resolve the hanging worker promise so its microtask queue drains and
    // Deno's leak detector stays happy.
    resolveWorker?.();
  },
);

Deno.test("workers-dispatch backend deletes stale message queue consumers during sync", async () => {
  const queueCalls: unknown[] = [];
  const backend = createWorkersDispatchDeploymentBackend({
    workers: {
      createWorker() {
        return Promise.resolve();
      },
    },
    queues: {
      upsertQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "upsert", queueName, input });
        return Promise.resolve({ id: "consumer-2", queueName });
      },
      deleteQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "delete", queueName, input });
        return Promise.resolve(1);
      },
    },
  } as never);

  await backend.syncQueueConsumers?.({
    deployment: {
      id: "dep-2",
      space_id: "space-1",
      target_json: JSON.stringify({
        queue_consumers: [{
          binding: "NEW_QUEUE",
        }],
      }),
    } as Deployment,
    artifactRef: "app-web-v2",
    runtime: {
      profile: "workers",
      bindings: [{
        type: "queue",
        name: "NEW_QUEUE",
        queue_name: "new-delivery",
      }],
    },
    previousDeployment: {
      id: "dep-1",
      space_id: "space-1",
      artifact_ref: "app-web-v1",
      target_json: JSON.stringify({
        queue_consumers: [{
          binding: "OLD_QUEUE",
        }],
      }),
    } as Deployment,
    previousRuntime: {
      profile: "workers",
      bindings: [{
        type: "queue",
        name: "OLD_QUEUE",
        queue_name: "old-delivery",
      }],
    },
  });

  assertEquals(queueCalls, [
    {
      action: "upsert",
      queueName: "new-delivery",
      input: { scriptName: "app-web-v2" },
    },
    {
      action: "delete",
      queueName: "old-delivery",
      input: { scriptName: "app-web-v1" },
    },
  ]);
});

Deno.test("workers-dispatch backend replaces previous message queue consumer explicitly", async () => {
  const queueCalls: unknown[] = [];
  const backend = createWorkersDispatchDeploymentBackend({
    workers: {
      createWorker() {
        return Promise.resolve();
      },
    },
    queues: {
      upsertQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "upsert", queueName, input });
        return Promise.resolve({ id: "consumer-2", queueName });
      },
      deleteQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "delete", queueName, input });
        return Promise.resolve(1);
      },
    },
  } as never);

  await backend.syncQueueConsumers?.({
    deployment: {
      id: "dep-2",
      space_id: "space-1",
      target_json: JSON.stringify({
        queue_consumers: [{ binding: "DELIVERY_QUEUE" }],
      }),
    } as Deployment,
    artifactRef: "app-web-v2",
    runtime: {
      profile: "workers",
      bindings: [{
        type: "queue",
        name: "DELIVERY_QUEUE",
        queue_name: "delivery",
      }],
    },
    previousDeployment: {
      id: "dep-1",
      space_id: "space-1",
      artifact_ref: "app-web-v1",
      target_json: JSON.stringify({
        queue_consumers: [{ binding: "DELIVERY_QUEUE" }],
      }),
    } as Deployment,
    previousRuntime: {
      profile: "workers",
      bindings: [{
        type: "queue",
        name: "DELIVERY_QUEUE",
        queue_name: "delivery",
      }],
    },
  });

  assertEquals(queueCalls, [
    {
      action: "upsert",
      queueName: "delivery",
      input: {
        scriptName: "app-web-v2",
        replaceScriptName: "app-web-v1",
      },
    },
    {
      action: "delete",
      queueName: "delivery",
      input: { scriptName: "app-web-v1" },
    },
  ]);
});

Deno.test("workers-dispatch backend restores previous message queue consumers after sync failure", async () => {
  const queueCalls: unknown[] = [];
  const backend = createWorkersDispatchDeploymentBackend({
    workers: {
      createWorker() {
        return Promise.resolve();
      },
    },
    queues: {
      upsertQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "upsert", queueName, input });
        return Promise.resolve({ id: "consumer-2", queueName });
      },
      deleteQueueConsumerByQueueName(queueName: string, input: unknown) {
        queueCalls.push({ action: "delete", queueName, input });
        if (queueName === "old-delivery") {
          return Promise.reject(new Error("delete failed"));
        }
        return Promise.resolve(1);
      },
    },
  } as never);

  await assertRejects(
    async () => {
      await backend.syncQueueConsumers!({
        deployment: {
          id: "dep-2",
          space_id: "space-1",
          target_json: JSON.stringify({
            queue_consumers: [{ binding: "NEW_QUEUE" }],
          }),
        } as Deployment,
        artifactRef: "app-web-v2",
        runtime: {
          profile: "workers",
          bindings: [{
            type: "queue",
            name: "NEW_QUEUE",
            queue_name: "new-delivery",
          }],
        },
        previousDeployment: {
          id: "dep-1",
          space_id: "space-1",
          artifact_ref: "app-web-v1",
          target_json: JSON.stringify({
            queue_consumers: [{ binding: "OLD_QUEUE" }],
          }),
        } as Deployment,
        previousRuntime: {
          profile: "workers",
          bindings: [{
            type: "queue",
            name: "OLD_QUEUE",
            queue_name: "old-delivery",
          }],
        },
      });
    },
    Error,
    "delete failed",
  );

  assertEquals(queueCalls, [
    {
      action: "upsert",
      queueName: "new-delivery",
      input: { scriptName: "app-web-v2" },
    },
    {
      action: "delete",
      queueName: "old-delivery",
      input: { scriptName: "app-web-v1" },
    },
    {
      action: "upsert",
      queueName: "old-delivery",
      input: { scriptName: "app-web-v1" },
    },
    {
      action: "delete",
      queueName: "new-delivery",
      input: { scriptName: "app-web-v2" },
    },
  ]);
});
