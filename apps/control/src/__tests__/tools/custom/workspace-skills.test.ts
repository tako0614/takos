import type { D1Database } from "@cloudflare/workers-types";

import type { ToolContext } from "@/tools/types";
import type { Env } from "@/types";

import {
  SKILL_CREATE,
  SKILL_LIST,
  SKILL_TOGGLE,
  skillCreateHandler,
  skillDeleteHandler,
  skillGetHandler,
  skillToggleHandler,
  skillUpdateHandler,
  WORKSPACE_SKILL_HANDLERS,
  WORKSPACE_SKILL_TOOLS,
} from "@/tools/custom/space-skills";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: () => undefined,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: () => undefined,
    ...overrides,
  };
}

Deno.test("space skill tool definitions - defines all nine tools", () => {
  assertEquals(WORKSPACE_SKILL_TOOLS.length, 9);
  const names = WORKSPACE_SKILL_TOOLS.map((tool) => tool.name);
  assert(names.includes("skill_list"));
  assert(names.includes("skill_get"));
  assert(names.includes("skill_create"));
  assert(names.includes("skill_update"));
  assert(names.includes("skill_toggle"));
  assert(names.includes("skill_delete"));
  assert(names.includes("skill_context"));
  assert(names.includes("skill_catalog"));
  assert(names.includes("skill_describe"));
});

Deno.test("space skill tool definitions - all tools have space category", () => {
  for (const def of WORKSPACE_SKILL_TOOLS) {
    assertEquals(def.category, "space");
  }
});

Deno.test("space skill tool definitions - WORKSPACE_SKILL_HANDLERS maps all tools", () => {
  for (const def of WORKSPACE_SKILL_TOOLS) {
    assert(def.name in WORKSPACE_SKILL_HANDLERS);
  }
});

Deno.test("space skill tool definitions - skill_create requires name and instructions", () => {
  assertEquals(SKILL_CREATE.parameters.required, ["name", "instructions"]);
});

Deno.test("space skill tool definitions - skill_toggle requires enabled", () => {
  assertEquals(SKILL_TOGGLE.parameters.required, ["skill_id", "enabled"]);
});

Deno.test("space skill tool definitions - skill_list has no required params", () => {
  assertEquals(SKILL_LIST.parameters.required, undefined);
});

Deno.test("skillGetHandler - throws when skill_id is missing", async () => {
  await assertRejects(async () => {
    await skillGetHandler({}, makeContext());
  }, "skill_id is required");
});

Deno.test("skillCreateHandler - throws when name is empty", async () => {
  await assertRejects(async () => {
    await skillCreateHandler({ name: "", instructions: "test" }, makeContext());
  }, "name is required");
});

Deno.test("skillCreateHandler - throws when instructions is empty", async () => {
  await assertRejects(async () => {
    await skillCreateHandler({ name: "test", instructions: "" }, makeContext());
  }, "instructions is required");
});

Deno.test("skillUpdateHandler - throws when skill_id is missing", async () => {
  await assertRejects(async () => {
    await skillUpdateHandler({ instructions: "new" }, makeContext());
  }, "skill_id is required");
});

Deno.test("skillToggleHandler - throws when skill_id is missing", async () => {
  await assertRejects(async () => {
    await skillToggleHandler({ enabled: true }, makeContext());
  }, "skill_id is required");
});

Deno.test("skillDeleteHandler - throws when skill_id is missing", async () => {
  await assertRejects(async () => {
    await skillDeleteHandler({}, makeContext());
  }, "skill_id is required");
});
