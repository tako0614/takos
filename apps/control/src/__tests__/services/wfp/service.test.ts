import {
  createWfpService,
  getTakosMigrationSQL,
  getTakosWorkerScript,
  WFPService,
} from "@/services/wfp/service";
import type { WFPConfig } from "@/services/wfp/client";
import { MockR2Bucket } from "../../../../test/integration/setup.ts";

// ---------------------------------------------------------------------------
// createWfpService
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("createWfpService - returns WFPService when env is configured", () => {
  const svc = createWfpService({
    CF_ACCOUNT_ID: "acc",
    CF_API_TOKEN: "tok",
    WFP_DISPATCH_NAMESPACE: "ns",
  });
  assert(svc instanceof WFPService);
});
Deno.test("createWfpService - returns null when env is missing required values", () => {
  const svc = createWfpService({
    CF_ACCOUNT_ID: undefined,
    CF_API_TOKEN: "tok",
    WFP_DISPATCH_NAMESPACE: "ns",
  } as never);
  assertEquals(svc, null);
});
// ---------------------------------------------------------------------------
// WFPService
// ---------------------------------------------------------------------------

const config: WFPConfig = {
  accountId: "test-acc",
  apiToken: "test-token",
  dispatchNamespace: "test-ns",
};

let currentFetchRestore: (() => void) | undefined;

function mockSuccessResponse<T>(result: T) {
  return new Response(
    JSON.stringify({
      success: true,
      result,
      errors: [],
      messages: [],
    }),
    { status: 200 },
  );
}

function installFetchMock(fetchMock: typeof fetch): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;
  const restore = () => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  };
  currentFetchRestore = restore;
  return restore;
}

function restoreFetchMock(): void {
  const restore = currentFetchRestore;
  currentFetchRestore = undefined;
  restore?.();
}

Deno.test("WFPService - createWorker - sends PUT request with FormData containing worker script and metadata", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.createWorker({
      workerName: "my-worker",
      workerScript: 'export default { fetch() { return new Response("ok"); } }',
      bindings: [
        { type: "plain_text", name: "MY_VAR", text: "value" },
      ],
    });

    assertSpyCalls(fetchMock, 1);
    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/scripts/my-worker");
    assertEquals(init.method, "PUT");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createWorker - serializes vectorize bindings into worker metadata", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.createWorker({
      workerName: "vector-worker",
      workerScript: 'export default { fetch() { return new Response("ok"); } }',
      bindings: [
        {
          type: "vectorize",
          name: "SEARCH_INDEX",
          index_name: "semantic-index",
        },
      ],
    });

    const [, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const metadataBlob = (init.body as FormData).get("metadata") as Blob;
    const metadata = JSON.parse(await metadataBlob.text());
    assert(
      metadata.bindings.some((item: any) =>
        JSON.stringify(item) === JSON.stringify({
          type: "vectorize",
          name: "SEARCH_INDEX",
          index_name: "semantic-index",
        })
      ),
    );
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createWorker - serializes queue and analytics bindings into worker metadata", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.createWorker({
      workerName: "resource-worker",
      workerScript: 'export default { fetch() { return new Response("ok"); } }',
      bindings: [
        { type: "queue", name: "JOB_QUEUE", queue_name: "jobs" },
        { type: "analytics_engine", name: "EVENTS", dataset: "events" },
      ],
    });

    const [, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const metadataBlob = (init.body as FormData).get("metadata") as Blob;
    const metadata = JSON.parse(await metadataBlob.text());
    assertEquals(metadata.bindings, [
      { type: "queue", name: "JOB_QUEUE", queue_name: "jobs" },
      { type: "analytics_engine", name: "EVENTS", dataset: "events" },
    ]);
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createWorker - serializes workflow bindings into worker metadata", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.createWorker({
      workerName: "workflow-worker",
      workerScript: 'export default { fetch() { return new Response("ok"); } }',
      bindings: [
        {
          type: "workflow",
          name: "PUBLISH_FLOW",
          workflow_name: "publish-flow",
          class_name: "PublishWorkflow",
        },
      ],
    });

    const [, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const metadataBlob = (init.body as FormData).get("metadata") as Blob;
    const metadata = JSON.parse(await metadataBlob.text());
    assert(
      metadata.bindings.some((item: any) =>
        JSON.stringify(item) === JSON.stringify({
          type: "workflow",
          name: "PUBLISH_FLOW",
          workflow_name: "publish-flow",
          class_name: "PublishWorkflow",
        })
      ),
    );
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - deleteWorker - sends DELETE request for the worker", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse(null));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.deleteWorker("worker-to-delete");

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/scripts/worker-to-delete");
    assertEquals(init.method, "DELETE");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - deleteQueue - sends DELETE request for the queue", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse(null));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.queues.deleteQueue("queue-id-123");

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/queues/queue-id-123");
    assertEquals(init.method, "DELETE");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - getWorker - returns result from GET request", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse({ id: "worker-1", script: "test" })
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const result = await svc.workers.getWorker("worker-1");
    assertEquals(result, { id: "worker-1", script: "test" });
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - workerExists - returns true when worker exists", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const exists = await svc.workers.workerExists("existing-worker");
    assertEquals(exists, true);
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - workerExists - returns false when worker returns 404", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 404, message: "Not found" }],
          messages: [],
          result: null,
        }),
        { status: 404 },
      )
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const exists = await svc.workers.workerExists("missing-worker");
    assertEquals(exists, false);
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - listWorkers - returns workers array from API", async () => {
  try {
    const workers = [
      {
        id: "w1",
        script: "test",
        created_on: "2025-01-01",
        modified_on: "2025-01-01",
      },
    ];
    const fetchMock = spy(async () => mockSuccessResponse(workers));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const result = await svc.workers.listWorkers();
    assertEquals(result.length, 1);
    assertEquals(result[0].id, "w1");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - createD1Database - returns the uuid from API response", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse({ uuid: "db-uuid-123" })
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const uuid = await svc.d1.createD1Database("my-db");
    assertEquals(uuid, "db-uuid-123");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createD1Database - throws when no uuid returned", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await assertRejects(async () => {
      await svc.d1.createD1Database("my-db");
    }, "no UUID");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - createR2Bucket - sends POST request to create bucket", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse(null));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.r2.createR2Bucket("my-bucket");

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/r2/buckets");
    assertEquals(init.method, "POST");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - createQueue - returns the queue metadata from API response", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse({ queue_id: "queue-id-123", queue_name: "my-queue" })
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const queue = await svc.queues.createQueue("my-queue");
    assertEquals(queue.id, "queue-id-123");
    assertEquals(queue.name, "my-queue");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createQueue - throws when no queue id returned", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await assertRejects(
      async () => {
        await svc.queues.createQueue("my-queue");
      },
      Error,
      "no ID returned from API",
    );
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - createKVNamespace - returns the id from API response", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({ id: "kv-ns-id" }));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const id = await svc.kv.createKVNamespace("my-kv");
    assertEquals(id, "kv-ns-id");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createKVNamespace - reuses an existing namespace when create reports a duplicate title", async () => {
  try {
    const fetchMock = spy(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (fetchMock.calls.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            result: null,
            errors: [{
              code: 10014,
              message:
                "a namespace with this account ID and title already exists",
            }],
            messages: [],
          }),
          { status: 400 },
        );
      }
      if (url.includes("/storage/kv/namespaces?per_page=1000")) {
        return mockSuccessResponse([
          { id: "existing-kv-ns-id", title: "my-kv" },
        ]);
      }
      return mockSuccessResponse({});
    });
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const id = await svc.kv.createKVNamespace("my-kv");

    assertEquals(id, "existing-kv-ns-id");
    assertSpyCalls(fetchMock, 2);
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - createKVNamespace - throws when no id returned", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await assertRejects(async () => {
      await svc.kv.createKVNamespace("kv");
    }, "no ID");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - createVectorizeIndex - returns the index name", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse({ name: "my-index" })
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const name = await svc.vectorize.createVectorizeIndex("my-index", {
      dimensions: 1536,
      metric: "cosine",
    });
    assertEquals(name, "my-index");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - runD1SQL - returns query results", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse([{ results: [{ count: 42 }] }])
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const result = await svc.d1.runD1SQL(
      "db-id",
      "SELECT COUNT(*) as count FROM users",
    );
    assertEquals(result, [{ results: [{ count: 42 }] }]);
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - listD1Tables - extracts table names from D1 query result", async () => {
  try {
    const fetchMock = spy(async () =>
      mockSuccessResponse([{
        results: [{ name: "users" }, { name: "posts" }],
      }])
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const tables = await svc.d1.listD1Tables("db-id");
    assertEquals(tables, [{ name: "users" }, { name: "posts" }]);
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - updateWorkerSettings - sends PATCH request with settings", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse(null));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.workers.updateWorkerSettings({
      workerName: "w1",
      bindings: [{ type: "plain_text", name: "ENV", text: "prod" }],
    });

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/scripts/w1/settings");
    assertEquals(init.method, "PATCH");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - uploadToR2 - sends PUT request to R2 endpoint", async () => {
  try {
    const fetchMock = spy(async () => new Response("ok", { status: 200 }));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.r2.uploadToR2("my-bucket", "path/to/file.txt", "file content", {
      contentType: "text/plain",
    });

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;
    assertStringIncludes(url, "/r2/buckets/my-bucket/objects/");
    assertEquals(init.method, "PUT");
    assertEquals(headers["Content-Type"], "text/plain");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - uploadToR2 - throws on non-ok response", async () => {
  try {
    const fetchMock = spy(async () => new Response("error", { status: 500 }));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await assertRejects(async () => {
      await svc.r2.uploadToR2("bucket", "key", "body");
    }, "Failed to upload");
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - getR2Object - reads object bytes from the R2 object endpoint", async () => {
  try {
    const fetchMock = spy(async () =>
      new Response("hello", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    const result = await svc.r2.getR2Object("my-bucket", "path/to/file.txt");

    const [url, init] = (fetchMock.calls[0] as any).args as [
      string,
      RequestInit,
    ];
    assertStringIncludes(url, "/r2/buckets/my-bucket/objects/");
    assertEquals(init.method, "GET");
    assertEquals(result?.contentType, "text/plain");
    assertEquals(new TextDecoder().decode(result?.body), "hello");
  } finally {
    restoreFetchMock();
  }
});
Deno.test("WFPService - getR2Object - returns null when the object does not exist", async () => {
  try {
    const fetchMock = spy(async () => new Response("missing", { status: 404 }));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await assertEquals(await svc.r2.getR2Object("bucket", "missing.txt"), null);
  } finally {
    restoreFetchMock();
  }
});

Deno.test("WFPService - deployWorkerWithBindings - throws when neither bundleUrl nor bundleScript provided", async () => {
  const svc = new WFPService(config);
  await assertRejects(async () => {
    await svc.deployWorkerWithBindings("w1", { bindings: [] });
  }, "Either bundleUrl or bundleScript is required");
});
Deno.test("WFPService - deployWorkerWithBindings - uses bundleScript directly when provided", async () => {
  try {
    const fetchMock = spy(async () => mockSuccessResponse({}));
    const restoreFetch = installFetchMock(fetchMock as unknown as typeof fetch);
    void restoreFetch;

    const svc = new WFPService(config);
    await svc.deployWorkerWithBindings("w1", {
      bindings: [{ type: "plain_text", name: "VAR", text: "val" }],
      bundleScript: "export default {}",
    });

    assertSpyCalls(fetchMock, 1);
  } finally {
    restoreFetchMock();
  }
});
// ---------------------------------------------------------------------------
// getTakosWorkerScript
// ---------------------------------------------------------------------------

Deno.test("getTakosWorkerScript - throws when WORKER_BUNDLES is not configured", async () => {
  await assertRejects(async () => {
    await getTakosWorkerScript({ WORKER_BUNDLES: undefined } as never);
  }, "WORKER_BUNDLES is not configured");
});
Deno.test("getTakosWorkerScript - throws when worker.js is missing from bucket", async () => {
  const bucket = new MockR2Bucket();
  await assertRejects(async () => {
    await getTakosWorkerScript({ WORKER_BUNDLES: bucket } as never);
  }, "worker.js is missing");
});
Deno.test("getTakosWorkerScript - returns worker script content from R2", async () => {
  const bucket = new MockR2Bucket();
  await bucket.put("worker.js", "export default { fetch() {} }");
  const script = await getTakosWorkerScript(
    { WORKER_BUNDLES: bucket } as never,
  );
  assertStringIncludes(script, "export default");
});
// ---------------------------------------------------------------------------
// getTakosMigrationSQL
// ---------------------------------------------------------------------------

Deno.test("getTakosMigrationSQL - returns a non-empty SQL string with CREATE TABLE statements", () => {
  const sql = getTakosMigrationSQL();
  assert(sql.length > 0);
  assertStringIncludes(sql, "CREATE TABLE");
  assertStringIncludes(sql, "local_users");
  assertStringIncludes(sql, "sessions");
  assertStringIncludes(sql, "posts");
});
