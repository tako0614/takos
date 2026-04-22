import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

import { assertEquals, assertRejects } from "jsr:@std/assert";

import {
  DEPLOYMENT_GET,
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_ROLLBACK,
  deploymentHistoryHandler,
  DOMAIN_ADD,
  DOMAIN_LIST,
  DOMAIN_REMOVE,
  DOMAIN_VERIFY,
  domainAddHandler,
  PLATFORM_HANDLERS,
  PLATFORM_TOOLS,
  SERVICE_CREATE,
  SERVICE_DELETE,
  SERVICE_ENV_GET,
  SERVICE_ENV_SET,
  SERVICE_LIST,
  SERVICE_RUNTIME_GET,
  SERVICE_RUNTIME_SET,
  workerDeleteHandler,
} from "@/tools/custom/platform";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    sessionId: "session-1",
    env: {
      TENANT_BASE_DOMAIN: "takos.jp",
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test("platform tools - exports the combined custom tool list", () => {
  const names = PLATFORM_TOOLS.map((tool) => tool.name);
  for (
    const name of [
      "service_env_get",
      "service_env_set",
      "service_runtime_get",
      "service_runtime_set",
      "domain_list",
      "domain_add",
      "domain_verify",
      "domain_remove",
      "service_list",
      "service_create",
      "service_delete",
      "deployment_history",
      "deployment_get",
      "deployment_rollback",
    ]
  ) {
    assertEquals(names.includes(name), true);
  }

  assertEquals(
    Object.keys(PLATFORM_HANDLERS).includes("service_env_get"),
    true,
  );
  assertEquals(
    Object.keys(PLATFORM_HANDLERS).includes("deployment_rollback"),
    true,
  );
});

Deno.test("platform tools - definitions expose the expected required arguments", () => {
  assertEquals(SERVICE_ENV_GET.parameters.required, ["service_name"]);
  assertEquals(SERVICE_ENV_SET.parameters.required, ["service_name", "env"]);
  assertEquals(SERVICE_RUNTIME_GET.parameters.required, ["service_name"]);
  assertEquals(SERVICE_RUNTIME_SET.parameters.required, ["service_name"]);
  assertEquals(DOMAIN_LIST.parameters.required, ["service_id"]);
  assertEquals(DOMAIN_ADD.parameters.required, ["service_id", "domain"]);
  assertEquals(DOMAIN_VERIFY.parameters.required, ["service_id", "domain"]);
  assertEquals(DOMAIN_REMOVE.parameters.required, ["service_id", "domain"]);
  assertEquals(SERVICE_LIST.parameters.required, undefined);
  assertEquals(SERVICE_CREATE.parameters.required, ["name", "type"]);
  assertEquals(SERVICE_DELETE.parameters.required, ["service_id", "confirm"]);
  assertEquals(DEPLOYMENT_HISTORY.parameters.required, ["service_id"]);
  assertEquals(DEPLOYMENT_GET.parameters.required, [
    "service_id",
    "deployment_id",
  ]);
  assertEquals(DEPLOYMENT_ROLLBACK.parameters.required, ["service_id"]);
});

Deno.test("domainAddHandler - rejects invalid domain syntax", async () => {
  await assertRejects(
    async () => {
      await domainAddHandler(
        { service_id: "w-1", domain: "not valid!" } as never,
        makeContext(),
      );
    },
    "Invalid domain format",
  );
});

Deno.test("workerDeleteHandler - rejects deletion without confirmation", async () => {
  await assertRejects(
    async () => {
      await workerDeleteHandler(
        { service_id: "w-1", confirm: false } as never,
        makeContext(),
      );
    },
    "Must set confirm=true to delete",
  );
});

Deno.test("deploymentHistoryHandler - rejects missing service_id", async () => {
  await assertRejects(
    async () => {
      await deploymentHistoryHandler(
        { service_id: "" } as never,
        makeContext(),
      );
    },
    "service_id is required",
  );
});
