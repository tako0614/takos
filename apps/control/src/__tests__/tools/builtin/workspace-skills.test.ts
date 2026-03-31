import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// [Deno] vi.mock removed - manually stub imports from '@/services/source/skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/official-skills'
import {
  createSkill,
  deleteSkillByName,
  describeAgentSkill,
  getSkill,
  getSkillByName,
  listSkillCatalog,
  listSkillContext,
  listSkills,
  updateSkill,
  updateSkillByName,
  updateSkillEnabled,
  updateSkillEnabledByName,
} from "@/services/source/skills";

import {
  SKILL_CATALOG,
  SKILL_CONTEXT,
  SKILL_CREATE,
  SKILL_DELETE,
  SKILL_DESCRIBE,
  SKILL_GET,
  SKILL_LIST,
  SKILL_TOGGLE,
  SKILL_UPDATE,
  skillCatalogHandler,
  skillContextHandler,
  skillCreateHandler,
  skillDeleteHandler,
  skillDescribeHandler,
  skillGetHandler,
  skillListHandler,
  skillToggleHandler,
  skillUpdateHandler,
  WORKSPACE_SKILL_HANDLERS,
  WORKSPACE_SKILL_TOOLS,
} from "@/tools/builtin/space-skills";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

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

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("workspace skill tool definitions - defines all nine tools", () => {
  assertEquals(WORKSPACE_SKILL_TOOLS.length, 9);
  const names = WORKSPACE_SKILL_TOOLS.map((t) => t.name);
  assertStringIncludes(names, "skill_list");
  assertStringIncludes(names, "skill_get");
  assertStringIncludes(names, "skill_create");
  assertStringIncludes(names, "skill_update");
  assertStringIncludes(names, "skill_toggle");
  assertStringIncludes(names, "skill_delete");
  assertStringIncludes(names, "skill_context");
  assertStringIncludes(names, "skill_catalog");
  assertStringIncludes(names, "skill_describe");
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
// ---------------------------------------------------------------------------
// skillListHandler
// ---------------------------------------------------------------------------

Deno.test("skillListHandler - returns a list of skills", async () => {
  listSkills = (async () =>
    [
      { id: "s1", name: "research", enabled: true },
      { id: "s2", name: "coding", enabled: false },
    ] as any) as any;

  const result = JSON.parse(await skillListHandler({}, makeContext()));

  assertEquals(result.count, 2);
  assertEquals(result.skills.length, 2);
});
Deno.test("skillListHandler - returns empty list", async () => {
  listSkills = (async () => []) as any;

  const result = JSON.parse(await skillListHandler({}, makeContext()));
  assertEquals(result.count, 0);
});
// ---------------------------------------------------------------------------
// skillGetHandler
// ---------------------------------------------------------------------------

Deno.test("skillGetHandler - throws when neither skill_id nor skill_name is provided", async () => {
  await assertRejects(async () => {
    await skillGetHandler({}, makeContext());
  }, "skill_id or skill_name is required");
});
Deno.test("skillGetHandler - gets skill by id", async () => {
  getSkill = (async () => ({ id: "s1", name: "research" } as any)) as any;

  const result = JSON.parse(
    await skillGetHandler({ skill_id: "s1" }, makeContext()),
  );
  assertEquals(result.skill.id, "s1");
});
Deno.test("skillGetHandler - gets skill by name", async () => {
  getSkillByName = (async () => ({ id: "s1", name: "research" } as any)) as any;

  const result = JSON.parse(
    await skillGetHandler({ skill_name: "research" }, makeContext()),
  );
  assertEquals(result.skill.name, "research");
});
Deno.test("skillGetHandler - throws when skill not found", async () => {
  getSkill = (async () => null) as any;

  await assertRejects(async () => {
    await skillGetHandler({ skill_id: "missing" }, makeContext());
  }, "Skill not found");
});
// ---------------------------------------------------------------------------
// skillCreateHandler
// ---------------------------------------------------------------------------

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
Deno.test("skillCreateHandler - throws when skill already exists", async () => {
  getSkillByName = (async () => ({ id: "s1" } as any)) as any;

  await assertRejects(async () => {
    await skillCreateHandler(
      { name: "existing", instructions: "test" },
      makeContext(),
    );
  }, "Skill already exists");
});
Deno.test("skillCreateHandler - creates a skill", async () => {
  getSkillByName = (async () => null) as any;
  createSkill = (async () => ({
    id: "s-new",
    name: "new-skill",
    instructions: "Do something",
  } as any)) as any;

  const result = JSON.parse(
    await skillCreateHandler(
      { name: "new-skill", instructions: "Do something", triggers: ["hello"] },
      makeContext(),
    ),
  );

  assertEquals(result.skill.id, "s-new");
  assertSpyCallArgs(createSkill, 0, [
    expect.anything(),
    "ws-test",
    {
      name: "new-skill",
      instructions: "Do something",
      triggers: ["hello"],
    },
  ]);
});
// ---------------------------------------------------------------------------
// skillUpdateHandler
// ---------------------------------------------------------------------------

Deno.test("skillUpdateHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillUpdateHandler({ instructions: "new" }, makeContext());
  }, "skill_id or skill_name is required");
});
Deno.test("skillUpdateHandler - updates skill by id", async () => {
  updateSkill = (async () => ({ id: "s1", name: "updated" } as any)) as any;

  const result = JSON.parse(
    await skillUpdateHandler(
      { skill_id: "s1", instructions: "updated instructions" },
      makeContext(),
    ),
  );
  assertEquals(result.skill.name, "updated");
});
Deno.test("skillUpdateHandler - updates skill by name", async () => {
  updateSkillByName =
    (async () => ({ id: "s1", name: "research" } as any)) as any;

  const result = JSON.parse(
    await skillUpdateHandler(
      { skill_name: "research", instructions: "new" },
      makeContext(),
    ),
  );
  assertEquals(result.skill.name, "research");
});
Deno.test("skillUpdateHandler - throws when skill not found", async () => {
  updateSkill = (async () => null) as any;

  await assertRejects(async () => {
    await skillUpdateHandler(
      { skill_id: "missing", instructions: "x" },
      makeContext(),
    );
  }, "Skill not found");
});
// ---------------------------------------------------------------------------
// skillToggleHandler
// ---------------------------------------------------------------------------

Deno.test("skillToggleHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillToggleHandler({ enabled: true }, makeContext());
  }, "skill_id or skill_name is required");
});
Deno.test("skillToggleHandler - toggles skill by id", async () => {
  getSkill = (async () => ({ id: "s1", name: "test" } as any)) as any;

  const result = JSON.parse(
    await skillToggleHandler({ skill_id: "s1", enabled: true }, makeContext()),
  );

  assertEquals(result.success, true);
  assertEquals(result.enabled, true);
  assertSpyCallArgs(updateSkillEnabled, 0, [expect.anything(), "s1", true]);
});
Deno.test("skillToggleHandler - toggles skill by name", async () => {
  const result = JSON.parse(
    await skillToggleHandler(
      { skill_name: "research", enabled: false },
      makeContext(),
    ),
  );

  assertEquals(result.success, true);
  assertEquals(result.enabled, false);
  assert(updateSkillEnabledByName.calls.length > 0);
});
Deno.test("skillToggleHandler - throws when skill_id not found", async () => {
  getSkill = (async () => null) as any;

  await assertRejects(async () => {
    await skillToggleHandler(
      { skill_id: "missing", enabled: true },
      makeContext(),
    );
  }, "Skill not found");
});
// ---------------------------------------------------------------------------
// skillDeleteHandler
// ---------------------------------------------------------------------------

Deno.test("skillDeleteHandler - throws when neither id nor name is provided", async () => {
  await assertRejects(async () => {
    await skillDeleteHandler({}, makeContext());
  }, "skill_id or skill_name is required");
});
Deno.test("skillDeleteHandler - deletes by id", async () => {
  getSkill = (async () => ({ id: "s1", name: "test" } as any)) as any;

  const result = JSON.parse(
    await skillDeleteHandler({ skill_id: "s1" }, makeContext()),
  );

  assertEquals(result.success, true);
  assertSpyCallArgs(deleteSkillByName, 0, [
    expect.anything(),
    "ws-test",
    "test",
  ]);
});
Deno.test("skillDeleteHandler - deletes by name", async () => {
  const result = JSON.parse(
    await skillDeleteHandler({ skill_name: "research" }, makeContext()),
  );

  assertEquals(result.success, true);
  assertSpyCallArgs(deleteSkillByName, 0, [
    expect.anything(),
    "ws-test",
    "research",
  ]);
});
Deno.test("skillDeleteHandler - throws when skill_id not found", async () => {
  getSkill = (async () => null) as any;

  await assertRejects(async () => {
    await skillDeleteHandler({ skill_id: "missing" }, makeContext());
  }, "Skill not found");
});
// ---------------------------------------------------------------------------
// skillContextHandler
// ---------------------------------------------------------------------------

Deno.test("skillContextHandler - returns skill context with locale", async () => {
  listSkillContext = (async () => ({
    locale: "ja",
    available_skills: [{ id: "official-1", name: "Research Brief" }],
  } as any)) as any;

  const result = JSON.parse(
    await skillContextHandler({ locale: "ja" }, makeContext()),
  );

  assertEquals(result.locale, "ja");
  assertEquals(result.count, 1);
  assertEquals(result.available_skills[0].name, "Research Brief");
});
// ---------------------------------------------------------------------------
// skillCatalogHandler
// ---------------------------------------------------------------------------

Deno.test("skillCatalogHandler - returns full catalog", async () => {
  listSkillCatalog = (async () => ({
    locale: "en",
    available_skills: [
      { id: "o1", name: "Research" },
      { id: "c1", name: "Custom Skill" },
    ],
  } as any)) as any;

  const result = JSON.parse(await skillCatalogHandler({}, makeContext()));

  assertEquals(result.locale, "en");
  assertEquals(result.count, 2);
});
// ---------------------------------------------------------------------------
// skillDescribeHandler
// ---------------------------------------------------------------------------

Deno.test("skillDescribeHandler - describes a skill", async () => {
  describeAgentSkill = (async () => ({
    id: "o1",
    name: "Research Brief",
    source: "official",
    instructions: "Research and summarize",
  } as any)) as any;

  const result = JSON.parse(
    await skillDescribeHandler({ skill_ref: "research-brief" }, makeContext()),
  );

  assertEquals(result.skill.name, "Research Brief");
  assertSpyCallArgs(describeAgentSkill, 0, [
    expect.anything(),
    "ws-test",
    { skillRef: "research-brief" },
  ]);
});
Deno.test("skillDescribeHandler - passes source hint", async () => {
  describeAgentSkill = (async () => ({ id: "c1" } as any)) as any;

  await skillDescribeHandler(
    { skill_ref: "my-skill", source: "custom" },
    makeContext(),
  );

  assertSpyCallArgs(describeAgentSkill, 0, [
    expect.anything(),
    "ws-test",
    { source: "custom" },
  ]);
});
Deno.test("skillDescribeHandler - passes deprecated skill_id and skill_name", async () => {
  describeAgentSkill = (async () => ({ id: "o1" } as any)) as any;

  await skillDescribeHandler(
    { skill_id: "old-id", skill_name: "old-name" },
    makeContext(),
  );

  assertSpyCallArgs(describeAgentSkill, 0, [
    expect.anything(),
    "ws-test",
    {
      skillId: "old-id",
      skillName: "old-name",
    },
  ]);
});
