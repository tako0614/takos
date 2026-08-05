import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";
import { buildWorkersWebPlatform } from "../adapters/workers.ts";
import type { Env } from "../../shared/types/index.ts";

function fakeContainerNamespace() {
  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response("container") }),
    getByName: () => ({ fetch: async () => new Response("container") }),
  };
}

test("workers adapter synthesizes only the in-process agent host binding", async () => {
  const env = {
    ADMIN_DOMAIN: "admin.example.com",
    TENANT_BASE_DOMAIN: "app.example.com",
    AUTH_PUBLIC_BASE_URL: "https://admin.example.com",
    EXECUTOR_CONTAINER: fakeContainerNamespace(),
    TAKOS_AGENT_START_TOKEN: "test-agent-start-token",
  } as unknown as Env;

  const platform = buildWorkersWebPlatform(env);

  assertEquals(platform.bindings.RUNTIME_HOST, undefined);
  assert(platform.bindings.EXECUTOR_HOST);
  assertEquals(platform.services.hosts.runtimeHost, undefined);
  assertEquals(
    platform.services.hosts.executorHost,
    platform.bindings.EXECUTOR_HOST,
  );
  const health = await platform.bindings.EXECUTOR_HOST.fetch(
    new Request("https://executor/health"),
  );
  assertEquals(health.status, 200);
});
