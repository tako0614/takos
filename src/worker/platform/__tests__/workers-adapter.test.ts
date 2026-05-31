import { test } from "bun:test";
import { assert, assertEquals } from "@std/assert";
import { buildWorkersWebPlatform } from "../adapters/workers.ts";
import type { Env } from "../../shared/types/index.ts";

function fakeContainerNamespace() {
  return {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response("container") }),
    getByName: () => ({ fetch: async () => new Response("container") }),
  };
}

test("workers adapter synthesizes in-process container host bindings", () => {
  const env = {
    ADMIN_DOMAIN: "admin.example.com",
    TENANT_BASE_DOMAIN: "app.example.com",
    AUTH_PUBLIC_BASE_URL: "https://admin.example.com",
    RUNTIME_CONTAINER: fakeContainerNamespace(),
    EXECUTOR_CONTAINER: fakeContainerNamespace(),
    TAKOS_EGRESS: { fetch: async () => new Response("takos") },
  } as unknown as Env;

  const platform = buildWorkersWebPlatform(env);

  assert(platform.bindings.RUNTIME_HOST);
  assert(platform.bindings.EXECUTOR_HOST);
  assertEquals(
    platform.services.hosts.runtimeHost,
    platform.bindings.RUNTIME_HOST,
  );
  assertEquals(
    platform.services.hosts.executorHost,
    platform.bindings.EXECUTOR_HOST,
  );
});

