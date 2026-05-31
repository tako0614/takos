import { CloudflareResourceService } from "@/platform/backends/cloudflare/resources.ts";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";

const env = {
  CF_ACCOUNT_ID: "acc-1",
  CF_API_TOKEN: "tok-1",
  WFP_DISPATCH_NAMESPACE: "ns-1",
};
const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
    originalFetch;
}

// Centralised helper for installing a spy-backed fetch implementation onto
// globalThis. Spies are structurally similar to `typeof fetch` but not
// assignable directly; this helper isolates the cast in one place.
function installMockFetch(
  mockFetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): void {
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch;
}

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

Deno.test("CloudflareResourceService - createResource - creates a SQL database and returns backing resource ids", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse({ uuid: "db-uuid-123" })
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("d1", "my-database");

    assertEquals(result.backingResourceId, "db-uuid-123");
    assertEquals(result.backingResourceName, "my-database");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - creates an object store and returns name as backing resource id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("r2", "my-bucket");

    assertEquals(result.backingResourceId, "my-bucket");
    assertEquals(result.backingResourceName, "my-bucket");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - creates a kv store and returns id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse({ id: "kv-id-456" })
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("kv", "my-kv");

    assertEquals(result.backingResourceId, "kv-id-456");
    assertEquals(result.backingResourceName, "my-kv");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - creates a vector-search index with default options", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse({ name: "my-index" })
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("vectorize", "my-index");

    assertEquals(result.backingResourceId, "my-index");
    assertEquals(result.backingResourceName, "my-index");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - creates a vector-search index with custom options", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse({ name: "custom-index" })
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("vectorize", "custom-index", {
      vectorize: { dimensions: 768, metric: "euclidean" },
    });

    assertEquals(result.backingResourceId, "custom-index");

    // Verify the body sent to the API contains the custom options
    const body = JSON.parse(
      (fetchMock.calls[0].args[1] as RequestInit).body as string,
    );
    assert(fetchMock.calls.length > 0);
    assertEquals(body, {
      config: {
        dimensions: 768,
        metric: "euclidean",
      },
      name: "custom-index",
    });
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - creates a queue and returns the queue id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse({ queue_id: "queue-id-123", queue_name: "my-queue" })
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("queue", "my-queue", {
      queue: { deliveryDelaySeconds: 10 },
    });

    assertEquals(result.backingResourceId, "queue-id-123");
    assertEquals(result.backingResourceName, "my-queue");
    assertStringIncludes(fetchMock.calls[0].args[0] as string, "/queues");
    assertEquals(
      JSON.parse((fetchMock.calls[0].args[1] as RequestInit).body as string),
      {
        queue_name: "my-queue",
        settings: {
          delivery_delay: 10,
        },
      },
    );
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - treats analytics_engine as a logical resource with no backing create call", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource(
      "analytics_engine",
      "event-dataset",
    );

    assertEquals(result, {
      backingResourceId: null,
      backingResourceName: "event-dataset",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - createResource - treats workflow as a logical resource with no backing create call", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    const result = await svc.createResource("workflow", "onboarding-flow");

    assertEquals(result, {
      backingResourceId: null,
      backingResourceName: "onboarding-flow",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("CloudflareResourceService - deleteResource - deletes a SQL database by backing resource id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "d1", backingResourceId: "db-uuid-123" });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/d1/database/db-uuid-123");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - deletes an object store by backing resource name", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "r2", backingResourceName: "my-bucket" });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/r2/buckets/my-bucket");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - deletes a queue by backing resource id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "queue",
      backingResourceId: "queue-id-123",
    });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/queues/queue-id-123");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - deletes a kv store by backing resource id", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "kv", backingResourceId: "kv-id-456" });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/storage/kv/namespaces/kv-id-456");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - deletes a vector-search index by backing resource name", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "vectorize",
      backingResourceName: "my-index",
    });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/vectorize/v2/indexes/my-index");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - is a no-op for analytics_engine resources", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "analytics_engine",
      backingResourceName: "event-dataset",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - is a no-op for workflow resources", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "workflow",
      backingResourceName: "onboarding-flow",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - deletes a tenant runtime by backing resource name", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "worker",
      backingResourceName: "worker-to-delete",
    });

    const url = fetchMock.calls[0].args[0] as string;
    assertStringIncludes(url, "/scripts/worker-to-delete");
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - is a no-op for SQL database when backing resource id is not provided", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "d1", backingResourceId: null });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - is a no-op for object store when backing resource name is not provided", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "r2", backingResourceName: null });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - is a no-op for unknown resource type", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({
      type: "unknown_type",
      backingResourceName: "x",
    });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});
Deno.test("CloudflareResourceService - deleteResource - handles whitespace in type parameter", async () => {
  try {
    const fetchMock = spy(async (..._args: Parameters<typeof fetch>) =>
      mockSuccessResponse(null)
    );
    installMockFetch(fetchMock);

    const svc = new CloudflareResourceService(env);
    await svc.deleteResource({ type: "  ", backingResourceName: "x" });
    assertSpyCalls(fetchMock, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("CloudflareResourceService - wfp property - exposes the WFP service for direct access", () => {
  try {
    const svc = new CloudflareResourceService(env);
    assert(svc.wfp !== undefined);
    assert(svc.wfp.d1 !== undefined);
  } finally {
    restoreFetch();
  }
});
