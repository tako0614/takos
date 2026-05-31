import { assertEquals } from "@std/assert";
import { assertSpyCallArgs, spy } from "@std/testing/mock";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: never[]) => unknown;
const mocks: {
  getDb: AnyMockFn;
  getResourceById: AnyMockFn;
  getPortableSecretValue: AnyMockFn;
} = {
  getDb: noopDep("resourceBindingDeps.getDb"),
  getResourceById: noopDep("resourceBindingDeps.getResourceById"),
  getPortableSecretValue: noopDep("resourceBindingDeps.getPortableSecretValue"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/store'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/portable-runtime'
import {
  buildBindingFromResource,
  resourceBindingDeps,
} from "@/services/resources/bindings";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";

let resourceBindingsGetDb = resourceBindingDeps.getDb;
let resourceBindingsGetResourceById = resourceBindingDeps.getResourceById;
let resourceBindingsGetPortableSecretValue =
  resourceBindingDeps.getPortableSecretValue;

Object.defineProperties(mocks, {
  getDb: {
    configurable: true,
    get: () => resourceBindingsGetDb,
    set: (value) => {
      resourceBindingsGetDb = value;
      resourceBindingDeps.getDb = value as typeof resourceBindingDeps.getDb;
    },
  },
  getResourceById: {
    configurable: true,
    get: () => resourceBindingsGetResourceById,
    set: (value) => {
      resourceBindingsGetResourceById = value;
      resourceBindingDeps.getResourceById =
        value as typeof resourceBindingDeps.getResourceById;
    },
  },
  getPortableSecretValue: {
    configurable: true,
    get: () => resourceBindingsGetPortableSecretValue,
    set: (value) => {
      resourceBindingsGetPortableSecretValue = value;
      resourceBindingDeps.getPortableSecretValue =
        value as typeof resourceBindingDeps.getPortableSecretValue;
    },
  },
});

mocks.getDb = resourceBindingDeps.getDb as AnyMockFn;
mocks.getResourceById = resourceBindingDeps.getResourceById as AnyMockFn;
mocks.getPortableSecretValue = resourceBindingDeps
  .getPortableSecretValue as AnyMockFn;

Deno.test("buildBindingFromResource - returns null when resource not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => null;

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_DB",
  );
  assertEquals(result, null);
});
Deno.test("buildBindingFromResource - returns null when resource is not active", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "d1",
    status: "deleting",
    backing_resource_id: "cf-123",
    backing_resource_name: "my-db",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_DB",
  );
  assertEquals(result, null);
});
Deno.test("buildBindingFromResource - builds SQL database binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "d1",
    status: "active",
    backing_resource_id: "cf-d1-123",
    backing_resource_name: "my-d1-db",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_DB",
  );

  assertEquals(result, {
    type: "d1",
    name: "MY_DB",
    id: "cf-d1-123",
  });
});
Deno.test("buildBindingFromResource - builds object store binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "r2",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: "my-bucket",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_BUCKET",
  );

  assertEquals(result, {
    type: "r2",
    name: "MY_BUCKET",
    bucket_name: "my-bucket",
  });
});
Deno.test("buildBindingFromResource - builds kv store binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "kv",
    status: "active",
    backing_resource_id: "kv-namespace-id",
    backing_resource_name: "my-kv",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_KV",
  );

  assertEquals(result, {
    type: "kv",
    name: "MY_KV",
    namespace_id: "kv-namespace-id",
  });
});
Deno.test("buildBindingFromResource - builds Vectorize binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "vectorize",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: "my-vectorize-index",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_VECTORS",
  );

  assertEquals(result, {
    type: "vectorize",
    name: "MY_VECTORS",
    index_name: "my-vectorize-index",
  });
});
Deno.test("buildBindingFromResource - builds message queue binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "queue",
    status: "active",
    backing_resource_id: "queue-id-123",
    backing_resource_name: "my-queue",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_QUEUE",
  );

  assertEquals(result, {
    type: "queue",
    name: "MY_QUEUE",
    queue_name: "my-queue",
  });
});
Deno.test("buildBindingFromResource - builds backend-backed message queue binding metadata", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "queue",
    status: "active",
    backend_name: "aws",
    backing_resource_id: "https://sqs.us-east-1.amazonaws.com/123/my-queue",
    backing_resource_name: "my-queue",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_QUEUE",
  );

  assertEquals(result, {
    type: "queue",
    name: "MY_QUEUE",
    queue_name: "my-queue",
    queue_backend: "sqs",
    queue_url: "https://sqs.us-east-1.amazonaws.com/123/my-queue",
    backend_name: "aws",
  });
});
Deno.test("buildBindingFromResource - builds Analytics Engine binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "analyticsEngine",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: "events-dataset",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "ANALYTICS",
  );

  assertEquals(result, {
    type: "analytics_engine",
    name: "ANALYTICS",
    dataset: "events-dataset",
  });
});
Deno.test("buildBindingFromResource - builds Secret binding", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "secretRef",
    status: "active",
    backing_resource_id: "secret-value",
    backing_resource_name: "my-secret",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "AUTH_SECRET",
  );

  assertEquals(result, {
    type: "secret_text",
    name: "AUTH_SECRET",
    text: "secret-value",
  });
});
Deno.test("buildBindingFromResource - resolves backend-backed Secret binding values on demand", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const getPortableSecretValueSpy = spy(async () => "portable-secret-value");
  mocks.getPortableSecretValue = getPortableSecretValueSpy;
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "secretRef",
    status: "active",
    backend_name: "aws",
    backing_resource_id: "secret-ref",
    backing_resource_name: "my-secret",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "AUTH_SECRET",
  );

  assertSpyCallArgs(getPortableSecretValueSpy, 0, [{
    id: "res-1",
    backend_name: "aws",
    backing_resource_id: "secret-ref",
    backing_resource_name: "my-secret",
  }]);
  assertEquals(result, {
    type: "secret_text",
    name: "AUTH_SECRET",
    text: "portable-secret-value",
  });
});
Deno.test("buildBindingFromResource - builds Durable Object binding from nested config", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "durableObject",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: "counter-resource",
    config: JSON.stringify({
      durableObject: {
        className: "Counter",
        scriptName: "edge-worker",
      },
    }),
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "COUNTER",
  );

  assertEquals(result, {
    type: "durable_object_namespace",
    name: "COUNTER",
    class_name: "Counter",
    script_name: "edge-worker",
  });
});
Deno.test("buildBindingFromResource - returns null for unknown resource type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "unknown",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: "test",
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_BINDING",
  );
  assertEquals(result, null);
});
Deno.test("buildBindingFromResource - handles null backing resource fields", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPortableSecretValue = async () => "portable-secret-value";
  mocks.getResourceById = async () => ({
    id: "res-1",
    type: "d1",
    status: "active",
    backing_resource_id: null,
    backing_resource_name: null,
  });

  const result = await buildBindingFromResource(
    noopSqlDatabaseBinding(),
    "res-1",
    "MY_DB",
  );

  assertEquals(result, {
    type: "d1",
    name: "MY_DB",
    id: undefined,
  });
});
