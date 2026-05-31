import type { WorkerEnv } from "@/worker/env";
import type {
  Ai,
  DurableObjectNamespace,
  KvStoreBinding,
  MessageQueueBinding,
  ObjectStoreBinding,
  SqlDatabaseBinding,
  VectorizeIndex,
} from "../../../shared/types/bindings.ts";

/**
 * WorkerEnv is a type-only module. These tests validate the type contract
 * by checking that mock objects satisfying the type compile correctly.
 * This ensures the type structure is stable and any breaking changes
 * to the unified env type are caught.
 */

import { assert, assertEquals } from "@std/assert";

// Structural placeholder bindings. They satisfy the binding shape used by the
// type contract but throw if accidentally invoked at runtime — these tests
// only inspect the value structure, never call the binding methods.
const stubDb = (): SqlDatabaseBinding => {
  const fail = (m: string) => () => {
    throw new Error(`stub DB.${m} called`);
  };
  return {
    prepare: fail("prepare"),
    batch: () => Promise.reject(new Error("stub DB.batch called")),
    exec: () => Promise.reject(new Error("stub DB.exec called")),
    withSession: fail("withSession"),
    dump: () => Promise.reject(new Error("stub DB.dump called")),
  };
};
const stubQueue = <T>(): MessageQueueBinding<T> => ({
  send: () => Promise.reject(new Error("stub queue.send called")),
  sendBatch: () => Promise.reject(new Error("stub queue.sendBatch called")),
});
const stubDoNamespace = (): DurableObjectNamespace => ({
  idFromName: () => ({}),
  get: () => ({ fetch: () => Promise.resolve(new Response()) }),
});
const stubKv = (): KvStoreBinding => ({
  get: () => Promise.resolve(null),
  getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve({ keys: [], list_complete: true }),
});
const stubObjectStore = (): ObjectStoreBinding => ({
  get: () => Promise.resolve(null),
  head: () => Promise.resolve(null),
  put: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
  list: () =>
    Promise.resolve({ objects: [], truncated: false, delimitedPrefixes: [] }),
});
const stubAi = (): Ai => ({
  run: () => Promise.reject(new Error("stub AI.run called")),
});
const stubVectorize = (): VectorizeIndex => ({
  query: () => Promise.resolve({ matches: [] }),
  insert: () => Promise.resolve(undefined),
  upsert: () => Promise.resolve(undefined),
  deleteByIds: () => Promise.resolve(undefined),
});

Deno.test("WorkerEnv type contract - accepts a minimal env with required fields", () => {
  const env: Partial<WorkerEnv> = {
    DB: stubDb(),
    RUN_QUEUE: stubQueue(),
    RUN_NOTIFIER: stubDoNamespace(),
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    HOSTNAME_ROUTING: stubKv(),
  };

  assertEquals(env.ADMIN_DOMAIN, "test.takos.jp");
  assertEquals(env.TENANT_BASE_DOMAIN, "app.test.takos.jp");
});
Deno.test("WorkerEnv type contract - accepts runner-specific fields", () => {
  const env: Partial<WorkerEnv> = {
    DB: stubDb(),
    EXECUTOR_HOST: { fetch: async () => new Response() },
    RUN_QUEUE: stubQueue(),
    RUN_NOTIFIER: stubDoNamespace(),
    TAKOS_OFFLOAD: stubObjectStore(),
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    HOSTNAME_ROUTING: stubKv(),
  };

  assert(env.EXECUTOR_HOST !== undefined);
  assert(env.TAKOS_OFFLOAD !== undefined);
});
Deno.test("WorkerEnv type contract - accepts indexer-specific fields", () => {
  const env: Partial<WorkerEnv> = {
    DB: stubDb(),
    AI: stubAi(),
    VECTORIZE: stubVectorize(),
    OPENAI_API_KEY: "sk-test",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GOOGLE_API_KEY: "test-google-key",
    GIT_OBJECTS: stubObjectStore(),
    TENANT_SOURCE: stubObjectStore(),
    INDEX_QUEUE: stubQueue(),
    RUN_QUEUE: stubQueue(),
    RUN_NOTIFIER: stubDoNamespace(),
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    HOSTNAME_ROUTING: stubKv(),
  };

  assert(env.AI !== undefined);
  assert(env.VECTORIZE !== undefined);
  assertEquals(env.OPENAI_API_KEY, "sk-test");
});
Deno.test("WorkerEnv type contract - accepts workflow-runner-specific fields", () => {
  const env: Partial<WorkerEnv> = {
    DB: stubDb(),
    RUNTIME_HOST: { fetch: async () => new Response() },
    ENCRYPTION_KEY: "test-key",
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    WFP_DISPATCH_NAMESPACE: "takos-tenants",
    CF_ACCOUNT_ID: "test-account",
    CF_API_TOKEN: "test-token",
    WORKER_BUNDLES: stubObjectStore(),
    TENANT_BUILDS: stubObjectStore(),
    HOSTNAME_ROUTING: stubKv(),
    RUN_QUEUE: stubQueue(),
    RUN_NOTIFIER: stubDoNamespace(),
    WORKFLOW_QUEUE: stubQueue(),
    DEPLOY_QUEUE: stubQueue(),
  };

  assert(env.RUNTIME_HOST !== undefined);
  assertEquals(env.ENCRYPTION_KEY, "test-key");
});
Deno.test("WorkerEnv type contract - accepts egress-specific fields", () => {
  const env: Partial<WorkerEnv> = {
    DB: stubDb(),
    RATE_LIMITER_DO: stubDoNamespace(),
    EGRESS_MAX_REQUESTS: "500",
    EGRESS_WINDOW_MS: "60000",
    EGRESS_RATE_LIMIT_ALGORITHM: "sliding_window",
    EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE: "0.1",
    EGRESS_MAX_RESPONSE_BYTES: "52428800",
    EGRESS_TIMEOUT_MS: "300000",
    RUN_QUEUE: stubQueue(),
    RUN_NOTIFIER: stubDoNamespace(),
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    HOSTNAME_ROUTING: stubKv(),
  };

  assertEquals(env.EGRESS_MAX_REQUESTS, "500");
  assertEquals(env.EGRESS_RATE_LIMIT_ALGORITHM, "sliding_window");
});
