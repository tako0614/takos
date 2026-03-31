import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;
const platformServiceMocks = {
  resolveServiceReferenceRecord: ((..._args: any[]) => undefined) as any,
  getServiceRouteRecord: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
const mockDesiredState = {
  listLocalEnvVarSummaries: ((..._args: any[]) => undefined) as any,
  replaceLocalEnvVars: ((..._args: any[]) => undefined) as any,
  listResourceBindings: ((..._args: any[]) => undefined) as any,
  replaceResourceBindings: ((..._args: any[]) => undefined) as any,
  getRuntimeConfig: ((..._args: any[]) => undefined) as any,
  saveRuntimeConfig: ((..._args: any[]) => undefined) as any,
  getRoutingTarget: ((..._args: any[]) => undefined) as any,
};

const mockCommonEnvDeps = {
  reconciler: {
    reconcileServiceCommonEnv: ((..._args: any[]) => undefined) as any,
  },
};

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/worker-desired-state'
const mockDeploymentService = {
  getDeploymentHistory: ((..._args: any[]) => undefined) as any,
  getDeploymentById: ((..._args: any[]) => undefined) as any,
  getDeploymentEvents: ((..._args: any[]) => undefined) as any,
  getMaskedEnvVars: ((..._args: any[]) => undefined) as any,
  getBindings: ((..._args: any[]) => undefined) as any,
  rollback: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/index'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/workers'
// [Deno] vi.mock removed - manually stub imports from '@/services/common-env'
// [Deno] vi.mock removed - manually stub imports from '@/services/common-env/crypto'
// [Deno] vi.mock removed - manually stub imports from '@/services/routing'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/custom-domains'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  getServiceRouteRecord,
  resolveServiceReferenceRecord,
} from "@/services/platform/workers";

import {
  DEPLOYMENT_GET,
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_ROLLBACK,
  deploymentGetHandler,
  deploymentHistoryHandler,
  deploymentRollbackHandler,
  DOMAIN_ADD,
  DOMAIN_LIST,
  DOMAIN_REMOVE,
  DOMAIN_VERIFY,
  domainAddHandler,
  domainListHandler,
  domainRemoveHandler,
  PLATFORM_HANDLERS,
  PLATFORM_TOOLS,
  SERVICE_BINDINGS_SET,
  SERVICE_CREATE,
  SERVICE_DELETE,
  SERVICE_ENV_GET,
  SERVICE_ENV_SET,
  SERVICE_LIST,
  SERVICE_RUNTIME_SET,
  workerBindingsSetHandler,
  workerCreateHandler,
  workerDeleteHandler,
  workerEnvGetHandler,
  workerEnvSetHandler,
  workerListHandler,
  workerRuntimeSetHandler,
} from "@/tools/builtin/platform";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {
      TENANT_BASE_DOMAIN: "takos.dev",
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Aggregate definitions
// ---------------------------------------------------------------------------

Deno.test("PLATFORM_TOOLS and PLATFORM_HANDLERS - exports combined tool list with all sub-modules", () => {
  const names = PLATFORM_TOOLS.map((t) => t.name);
  // Worker settings
  assertStringIncludes(names, "service_env_get");
  assertStringIncludes(names, "service_env_set");
  assertStringIncludes(names, "service_bindings_get");
  assertStringIncludes(names, "service_bindings_set");
  assertStringIncludes(names, "service_runtime_get");
  assertStringIncludes(names, "service_runtime_set");
  // Domains
  assertStringIncludes(names, "domain_list");
  assertStringIncludes(names, "domain_add");
  assertStringIncludes(names, "domain_verify");
  assertStringIncludes(names, "domain_remove");
  // Deployments
  assertStringIncludes(names, "service_list");
  assertStringIncludes(names, "service_create");
  assertStringIncludes(names, "service_delete");
  // Deployment history
  assertStringIncludes(names, "deployment_history");
  assertStringIncludes(names, "deployment_get");
  assertStringIncludes(names, "deployment_rollback");
});
Deno.test("PLATFORM_TOOLS and PLATFORM_HANDLERS - all tools have deploy category", () => {
  for (const def of PLATFORM_TOOLS) {
    assertEquals(def.category, "deploy");
  }
});
Deno.test("PLATFORM_TOOLS and PLATFORM_HANDLERS - PLATFORM_HANDLERS maps all tools", () => {
  for (const def of PLATFORM_TOOLS) {
    assert(def.name in PLATFORM_HANDLERS);
  }
});
// ---------------------------------------------------------------------------
// Worker settings definitions
// ---------------------------------------------------------------------------

Deno.test("service settings definitions - service_env_get requires service_name", () => {
  assertEquals(SERVICE_ENV_GET.parameters.required, ["service_name"]);
});
Deno.test("service settings definitions - service_env_set requires service_name and env", () => {
  assertEquals(SERVICE_ENV_SET.parameters.required, ["service_name", "env"]);
});
Deno.test("service settings definitions - service_runtime_set requires service_name", () => {
  assertEquals(SERVICE_RUNTIME_SET.parameters.required, ["service_name"]);
});
Deno.test("service settings definitions - service_bindings_set exposes Cloudflare-native binding kinds", () => {
  const bindingsItems =
    SERVICE_BINDINGS_SET.parameters.properties.bindings.items;
  assert(bindingsItems !== undefined);
  if (
    !bindingsItems || !("properties" in bindingsItems) ||
    !bindingsItems.properties?.type
  ) {
    throw new Error("bindings item schema must define type");
  }
  const enumValues = bindingsItems.properties.type.enum;
  assertEquals(enumValues, ["queue", "analyticsEngine"]);
});
// ---------------------------------------------------------------------------
// workerEnvGetHandler
// ---------------------------------------------------------------------------

Deno.test("workerEnvGetHandler - throws when service not found", async () => {
  resolveServiceReferenceRecord = (async () => null) as any;
  mockSelectGet = (async () => null) as any;

  await assertRejects(async () => {
    await workerEnvGetHandler({ service_name: "missing" }, makeContext());
  }, "Service not found");
});
Deno.test("workerEnvGetHandler - returns env vars for a service slot", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;
  mockDesiredState.listLocalEnvVarSummaries = (async () => [
    { name: "API_KEY", type: "secret_text" },
    { name: "DEBUG", type: "plain_text" },
  ]) as any;

  const result = await workerEnvGetHandler(
    { service_name: "my-worker" },
    makeContext(),
  );
  assertStringIncludes(result, "API_KEY");
  assertStringIncludes(result, "secret_text");
  assertStringIncludes(result, "DEBUG");
  assertStringIncludes(result, "plain_text");
});
// ---------------------------------------------------------------------------
// workerEnvSetHandler
// ---------------------------------------------------------------------------

Deno.test("workerEnvSetHandler - rejects mutation on deployment artifacts", async () => {
  resolveServiceReferenceRecord = (async () => null) as any;
  mockSelectGet = (async () => ({
    id: "d-1",
    workerId: "w-1",
    accountId: "ws-test",
  })) as any;

  await assertRejects(async () => {
    await workerEnvSetHandler(
      { service_name: "deploy-ref", env: [{ name: "X", value: "Y" }] },
      makeContext(),
    );
  }, "immutable");
});
Deno.test("workerEnvSetHandler - saves env vars for a service slot", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;

  const result = await workerEnvSetHandler(
    { service_name: "my-worker", env: [{ name: "KEY", value: "VAL" }] },
    makeContext(),
  );

  assertStringIncludes(result, "Saved 1 environment variable");
  assert(mockDesiredState.replaceLocalEnvVars.calls.length > 0);
});

Deno.test("workerBindingsSetHandler - normalizes queue and analytics bindings to canonical service binding types", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;
  mockSelectGet =
    (async () => ({ id: "res-q", type: "queue" })) as any =
      (async () => ({ id: "res-a", type: "analyticsEngine" })) as any;

  await workerBindingsSetHandler(
    {
      service_name: "my-worker",
      bindings: [
        { type: "queue", name: "JOB_QUEUE", id: "queue-handle" },
        { type: "analyticsEngine", name: "EVENTS", id: "analytics-handle" },
      ],
    },
    makeContext(),
  );

  assertSpyCallArgs(mockDesiredState.replaceResourceBindings, 0, [{
    workerId: "w-1",
    bindings: [
      { name: "JOB_QUEUE", type: "queue", resourceId: "res-q" },
      { name: "EVENTS", type: "analytics_store", resourceId: "res-a" },
    ],
  }]);
});
Deno.test("workerBindingsSetHandler - stores workflow binding metadata from the resource definition", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;
  mockSelectGet = (async () => ({
    id: "res-wf",
    type: "workflow",
    name: "publish-flow",
    providerResourceName: "publish-flow",
    config: JSON.stringify({
      workflowRuntime: {
        service: "api",
        export: "PublishWorkflow",
      },
    }),
  })) as any;

  await workerBindingsSetHandler(
    {
      service_name: "my-worker",
      bindings: [
        { type: "workflow", name: "PUBLISH_FLOW", id: "workflow-handle" },
      ],
    },
    makeContext(),
  );

  assertSpyCallArgs(mockDesiredState.replaceResourceBindings, 0, [{
    workerId: "w-1",
    bindings: [
      {
        name: "PUBLISH_FLOW",
        type: "workflow_runtime",
        resourceId: "res-wf",
        config: {
          workflowRuntime: {
            service: "api",
            export: "PublishWorkflow",
          },
        },
      },
    ],
  }]);
});
Deno.test("workerBindingsSetHandler - stores durable namespace binding metadata from the resource definition", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;
  mockSelectGet = (async () => ({
    id: "res-do",
    type: "durableObject",
    name: "counter-do",
    providerResourceName: "counter-do",
    config: JSON.stringify({
      durableNamespace: {
        className: "CounterDO",
        scriptName: "edge-worker",
      },
    }),
  })) as any;

  await workerBindingsSetHandler(
    {
      service_name: "my-worker",
      bindings: [
        { type: "durableObject", name: "COUNTER", id: "durable-handle" },
      ],
    },
    makeContext(),
  );

  assertSpyCallArgs(mockDesiredState.replaceResourceBindings, 0, [{
    workerId: "w-1",
    bindings: [
      {
        name: "COUNTER",
        type: "durable_namespace",
        resourceId: "res-do",
        config: {
          durableNamespace: {
            className: "CounterDO",
            scriptName: "edge-worker",
          },
        },
      },
    ],
  }]);
});
// ---------------------------------------------------------------------------
// workerRuntimeSetHandler
// ---------------------------------------------------------------------------

Deno.test("workerRuntimeSetHandler - saves runtime config", async () => {
  resolveServiceReferenceRecord = (async () => ({
    id: "w-1",
    accountId: "ws-test",
  } as any)) as any;

  const result = await workerRuntimeSetHandler(
    { service_name: "my-worker", compatibility_date: "2026-01-01" },
    makeContext(),
  );

  assertStringIncludes(result, "Updated runtime configuration");
  assert(mockDesiredState.saveRuntimeConfig.calls.length > 0);
});
// ---------------------------------------------------------------------------
// Domain definitions
// ---------------------------------------------------------------------------

Deno.test("domain definitions - domain_list requires service_id", () => {
  assertEquals(DOMAIN_LIST.parameters.required, ["service_id"]);
});
Deno.test("domain definitions - domain_add requires service_id and domain", () => {
  assertEquals(DOMAIN_ADD.parameters.required, ["service_id", "domain"]);
});
Deno.test("domain definitions - domain_verify requires service_id and domain", () => {
  assertEquals(DOMAIN_VERIFY.parameters.required, ["service_id", "domain"]);
});
Deno.test("domain definitions - domain_remove requires service_id and domain", () => {
  assertEquals(DOMAIN_REMOVE.parameters.required, ["service_id", "domain"]);
});

Deno.test("domainListHandler - returns no domains message when empty", async () => {
  mockSelectAll = (async () => []) as any;

  const result = await domainListHandler({ service_id: "w-1" }, makeContext());
  assertStringIncludes(result, "No custom domains");
});
Deno.test("domainListHandler - lists domains with status icons", async () => {
  mockSelectAll = (async () => [
    { domain: "app.example.com", status: "active", createdAt: "2026-01-01" },
    {
      domain: "staging.example.com",
      status: "pending",
      createdAt: "2026-01-02",
    },
  ]) as any;

  const result = await domainListHandler({ service_id: "w-1" }, makeContext());
  assertStringIncludes(result, "app.example.com");
  assertStringIncludes(result, "staging.example.com");
});

Deno.test("domainAddHandler - rejects invalid domain format", async () => {
  await assertRejects(async () => {
    await domainAddHandler(
      { service_id: "w-1", domain: "not valid!" },
      makeContext(),
    );
  }, "Invalid domain format");
});

Deno.test("domainRemoveHandler - throws when domain not found", async () => {
  mockSelectGet = (async () => null) as any;

  await assertRejects(async () => {
    await domainRemoveHandler(
      { service_id: "w-1", domain: "missing.example.com" },
      makeContext(),
    );
  }, "Domain not found");
});
// ---------------------------------------------------------------------------
// Worker deployment definitions
// ---------------------------------------------------------------------------

Deno.test("service deployment definitions - service_list has no required params", () => {
  assertEquals(SERVICE_LIST.parameters.required, undefined);
});
Deno.test("service deployment definitions - service_create requires name and type", () => {
  assertEquals(SERVICE_CREATE.parameters.required, ["name", "type"]);
});
Deno.test("service deployment definitions - service_delete requires service_id and confirm", () => {
  assertEquals(SERVICE_DELETE.parameters.required, ["service_id", "confirm"]);
});

Deno.test("workerListHandler - returns no workers message when empty", async () => {
  mockSelectAll = (async () => []) as any;

  const result = await workerListHandler({}, makeContext());
  assertEquals(result, "No services found.");
});

Deno.test("workerCreateHandler - creates a service slot and returns details", async () => {
  const result = await workerCreateHandler(
    { name: "My App", type: "app" },
    makeContext(),
  );

  assertStringIncludes(result, "Service slot created");
  assertStringIncludes(result, "gen-id");
  assertStringIncludes(result, "My App");
  assertStringIncludes(result, "app");
});

Deno.test("workerDeleteHandler - throws when confirm is not true", async () => {
  await assertRejects(async () => {
    await workerDeleteHandler(
      { service_id: "w-1", confirm: false },
      makeContext(),
    );
  }, "Must set confirm=true");
});
Deno.test("workerDeleteHandler - throws when service not found", async () => {
  getServiceRouteRecord = (async () => null) as any;

  await assertRejects(async () => {
    await workerDeleteHandler(
      { service_id: "w-1", confirm: true },
      makeContext(),
    );
  }, "Service not found");
});
// ---------------------------------------------------------------------------
// Deployment history definitions
// ---------------------------------------------------------------------------

Deno.test("deployment history definitions - deployment_history requires service_id", () => {
  assertEquals(DEPLOYMENT_HISTORY.parameters.required, ["service_id"]);
});
Deno.test("deployment history definitions - deployment_get requires service_id and deployment_id", () => {
  assertEquals(DEPLOYMENT_GET.parameters.required, [
    "service_id",
    "deployment_id",
  ]);
});
Deno.test("deployment history definitions - deployment_rollback requires service_id", () => {
  assertEquals(DEPLOYMENT_ROLLBACK.parameters.required, ["service_id"]);
});

Deno.test("deploymentHistoryHandler - throws when service_id is empty", async () => {
  await assertRejects(async () => {
    await deploymentHistoryHandler({ service_id: "" }, makeContext());
  }, "service_id is required");
});
Deno.test("deploymentHistoryHandler - returns deployment history as JSON", async () => {
  mockSelectGet = (async () => ({ id: "w-1" })) as any; // ensureWorkerInWorkspace
  mockDeploymentService.getDeploymentHistory = (async () => [
    { id: "d-1", version: 1, status: "deployed", created_at: "2026-01-01" },
  ]) as any;

  const result = JSON.parse(
    await deploymentHistoryHandler({ service_id: "w-1" }, makeContext()),
  );
  assertEquals(result.count, 1);
  assertEquals(result.deployments.length, 1);
});

Deno.test("deploymentGetHandler - throws when service_id is empty", async () => {
  await assertRejects(async () => {
    await deploymentGetHandler(
      { service_id: "", deployment_id: "d-1" },
      makeContext(),
    );
  }, "service_id is required");
});
Deno.test("deploymentGetHandler - throws when deployment_id is empty", async () => {
  await assertRejects(async () => {
    await deploymentGetHandler(
      { service_id: "w-1", deployment_id: "" },
      makeContext(),
    );
  }, "deployment_id is required");
});
Deno.test("deploymentGetHandler - throws when deployment not found", async () => {
  mockSelectGet = (async () => ({ id: "w-1" })) as any; // ensureWorkerInWorkspace
  mockDeploymentService.getDeploymentById = (async () => null) as any;

  await assertRejects(async () => {
    await deploymentGetHandler(
      { service_id: "w-1", deployment_id: "d-1" },
      makeContext(),
    );
  }, "Deployment not found");
});

Deno.test("deploymentRollbackHandler - throws when service_id is empty", async () => {
  await assertRejects(async () => {
    await deploymentRollbackHandler({ service_id: "" }, makeContext());
  }, "service_id is required");
});
Deno.test("deploymentRollbackHandler - performs rollback", async () => {
  mockSelectGet = (async () => ({ id: "w-1" })) as any; // ensureWorkerInWorkspace
  mockDeploymentService.rollback = (async () => ({
    id: "d-2",
    status: "deploying",
  })) as any;

  const result = JSON.parse(
    await deploymentRollbackHandler({ service_id: "w-1" }, makeContext()),
  );
  assertEquals(result.success, true);
  assertEquals(result.deployment.id, "d-2");
});
