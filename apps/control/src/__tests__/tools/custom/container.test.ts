import { assert, assertEquals } from "jsr:@std/assert";

import {
  CONTAINER_COMMIT,
  CONTAINER_HANDLERS,
  CONTAINER_START,
  CONTAINER_TOOLS,
  CREATE_REPOSITORY,
} from "@/tools/custom/container";

Deno.test("container tool definitions - defines all five container tools", () => {
  assertEquals(CONTAINER_TOOLS.length, 5);
  assertEquals(CONTAINER_TOOLS.map((t) => t.name), [
    "container_start",
    "container_status",
    "container_commit",
    "container_stop",
    "create_repository",
  ]);
});

Deno.test("container tool definitions - all tools have container category", () => {
  for (const def of CONTAINER_TOOLS) {
    assertEquals(def.category, "container");
  }
});

Deno.test("container tool definitions - CONTAINER_HANDLERS maps all tools", () => {
  assertEquals(Object.keys(CONTAINER_HANDLERS).sort(), [
    "container_commit",
    "container_start",
    "container_status",
    "container_stop",
    "create_repository",
  ]);
});

Deno.test("container tool definitions - parameters are stable", () => {
  assertEquals(CONTAINER_START.parameters.required, []);
  assert("repo_id" in CONTAINER_START.parameters.properties);
  assert("message" in CONTAINER_COMMIT.parameters.properties);
  assert("name" in CREATE_REPOSITORY.parameters.properties);
  assertEquals(CREATE_REPOSITORY.parameters.required, []);
});
