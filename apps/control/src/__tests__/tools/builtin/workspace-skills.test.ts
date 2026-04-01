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
} from "@/tools/builtin/space-skills";

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
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

Deno.test("workspace skill tool definitions - defines all nine tools", () => {
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

Deno.test("workspace skill tool definitions - all tools have workspace category", () => {
  for (const def of WORKSPACE_SKILL_TOOLS) {
    assertEquals(def.category, "workspace");
  }
});

Deno.test("workspace skill tool definitions - WORKSPACE_SKILL_HANDLERS maps all tools", () => {
  for (const def of WORKSPACE_SKILL_TOOLS) {
    assert(def.name in WORKSPACE_SKILL_HANDLERS);
  }
});

Deno.test("workspace skill tool definitions - skill_create requires name and instructions", () => {
  assertEquals(SKILL_CREATE.parameters.required, ["name", "instructions"]);
});

Deno.test("workspace skill tool definitions - skill_toggle requires enabled", () => {
  assertEquals(SKILL_TOGGLE.parameters.required, ["enabled"]);
});

Deno.test("workspace skill tool definitions - skill_list has no required params", () => {
  assertEquals(SKILL_LIST.parameters.required, undefined);
});

Deno.test("skillGetHandler - throws when neither skill_id nor skill_name is provided", async () => {
  await assertRejects(async () => {
    await skillGetHandler({}, makeContext());
  }, "skill_id or skill_name is required");
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

Deno.test("skillUpdateHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillUpdateHandler({ instructions: "new" }, makeContext());
  }, "skill_id or skill_name is required");
});

Deno.test("skillToggleHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillToggleHandler({ enabled: true }, makeContext());
  }, "skill_id or skill_name is required");
});

Deno.test("skillDeleteHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillDeleteHandler({}, makeContext());
  }, "skill_id or skill_name is required");
});
