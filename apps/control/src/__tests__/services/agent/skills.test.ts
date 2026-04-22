import type { D1Database } from "@cloudflare/workers-types";
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/mcp'
import {
  listLocalizedManagedSkills,
  listManagedSkillDefinitions,
  normalizeCustomSkillMetadata,
  resolveSkillLocale,
} from "@/services/agent/managed-skills";
import {
  activateSelectedSkills,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
  selectRelevantSkills,
  type SkillCatalogEntry,
  type SkillContext,
} from "@/services/agent/skills";
import { listManagedSkillsCatalog } from "@/services/source/skills";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

function withAvailability<
  T extends {
    source: "managed" | "custom";
    execution_contract: SkillContext["execution_contract"];
  },
>(skill: T): T & Pick<SkillContext, "availability" | "availability_reasons"> {
  return {
    ...skill,
    availability: "available",
    availability_reasons: [],
  };
}

Deno.test("managed skills registry - keeps Takos-managed skills uniquely identified and carries execution contracts", () => {
  const skills = listManagedSkillDefinitions();
  const ids = skills.map((skill) => skill.id);

  assertEquals(ids, [
    "research-brief",
    "writing-draft",
    "planning-structurer",
    "slides-author",
    "repo-app-operator",
  ]);
  assertEquals(new Set(ids).size, ids.length);
  assertEquals(
    skills.every((skill) => skill.locales.ja.triggers.length > 0),
    true,
  );
  assertEquals(
    skills.every((skill) => skill.locales.en.triggers.length > 0),
    true,
  );
  assertEquals(
    skills.every((skill) => skill.execution_contract.output_modes.length > 0),
    true,
  );
});

Deno.test("skill locale resolution - prefers explicit locale before inspecting text samples", () => {
  assertEquals(
    resolveSkillLocale({
      preferredLocale: "ja",
      textSamples: ["deploy an API"],
    }),
    "ja",
  );
  assertEquals(
    resolveSkillLocale({ acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8" }),
    "ja",
  );
  assertEquals(
    resolveSkillLocale({ textSamples: ["スライド資料を作って"] }),
    "ja",
  );
});

Deno.test("custom skill metadata normalization - normalizes structured metadata and drops invalid values", () => {
  assertEquals(
    normalizeCustomSkillMetadata({
      locale: "ja",
      category: "planning",
      activation_tags: ["roadmap", "phase"],
      execution_contract: {
        preferred_tools: ["create_artifact"],
        durable_output_hints: ["artifact", "invalid"],
        output_modes: ["artifact", "chat", "bogus"],
        required_mcp_servers: ["slides-mcp"],
        template_ids: ["roadmap-doc"],
      },
    }),
    {
      locale: "ja",
      category: "planning",
      activation_tags: ["roadmap", "phase"],
      execution_contract: {
        preferred_tools: ["create_artifact"],
        durable_output_hints: ["artifact"],
        output_modes: ["artifact", "chat"],
        required_mcp_servers: ["slides-mcp"],
        template_ids: ["roadmap-doc"],
      },
    },
  );
});

Deno.test("skill selection - selects the slide skill from thread and follow-up context, not just the latest message", () => {
  const managedSkills: SkillContext[] = listLocalizedManagedSkills("ja").map((
    skill,
  ) => ({
    ...skill,
    source: "managed",
    execution_contract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [...skill.execution_contract.durable_output_hints],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: "available",
    availability_reasons: [],
  }));

  const selected = selectRelevantSkills(managedSkills, {
    conversation: ["3枚目だけ短くして"],
    threadTitle: "顧客向けプレゼン資料",
    threadSummary: "営業デッキを作成している",
    threadKeyPoints: ["全10枚", "ROI の説明が必要"],
    agentType: "default",
  });

  const slideSelection = selected.find((entry) =>
    entry.skill.id === "slides-author"
  );
  assert(slideSelection);
  assertEquals(
    slideSelection?.reasons.some((reason) => reason.includes("thread title")),
    true,
  );
});
Deno.test("skill selection - uses delegated run input and execution contract hints for software tasks", () => {
  const managedSkills: SkillContext[] = listLocalizedManagedSkills("en").map((
    skill,
  ) => ({
    ...skill,
    source: "managed",
    execution_contract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [...skill.execution_contract.durable_output_hints],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: "available",
    availability_reasons: [],
  }));

  const plan = resolveSkillPlan(managedSkills, {
    locale: "en",
    conversation: ["make it public after it works"],
    runInput: {
      task: "Create a hello world API and deploy it as an app",
      locale: "en",
    },
    agentType: "implementer",
    availableTemplateIds: [
      "research-brief",
      "writing-draft",
      "planning-structurer",
      "slides-outline",
      "speaker-notes",
      "repo-app-bootstrap",
      "api-worker",
    ],
    maxTotalInstructionBytes: 100_000,
    maxPerSkillInstructionBytes: 50_000,
  });

  assertEquals(plan.selectedSkills[0]?.skill.id, "repo-app-operator");
  assertEquals(
    plan.selectedSkills[0]?.reasons.some((reason) =>
      reason.includes("output intent")
    ),
    true,
  );
});
Deno.test("skill selection - uses structured delegation context for skill selection and locale precedence", () => {
  const managedSkills: SkillContext[] = listLocalizedManagedSkills("ja").map((
    skill,
  ) => ({
    ...skill,
    source: "managed",
    execution_contract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [...skill.execution_contract.durable_output_hints],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: "available",
    availability_reasons: [],
  }));

  const plan = resolveSkillPlan(managedSkills, {
    locale: "ja",
    conversation: [],
    runInput: {
      delegation: {
        task: "Takos の app deploy 周りを修正して",
        goal: "sub-agent 自律性を上げる",
        deliverable: "コード変更とテスト",
        constraints: ["既存 API を壊さない"],
        context: ["apps/control が対象"],
        acceptance_criteria: ["targeted tests pass"],
        product_hint: "takos",
        locale: "ja",
        parent_run_id: "run-1",
        parent_thread_id: "thread-1",
        root_thread_id: "thread-1",
        thread_summary: "Takos control の修正",
        thread_key_points: ["delegation packet を導入する"],
      },
    },
    agentType: "implementer",
    availableTemplateIds: [
      "research-brief",
      "writing-draft",
      "planning-structurer",
      "slides-outline",
      "speaker-notes",
      "repo-app-bootstrap",
      "api-worker",
    ],
    maxTotalInstructionBytes: 100_000,
    maxPerSkillInstructionBytes: 50_000,
  });

  assertEquals(plan.locale, "ja");
  assertEquals(plan.selectedSkills[0]?.skill.id, "repo-app-operator");
});
Deno.test("skill selection - returns no selected skills when the context has no matching signals", () => {
  const customSkill: SkillContext = {
    id: "custom-1",
    name: "Workspace Macro",
    description: "Workspace-only helper",
    instructions: "Do a very specific workspace thing.",
    triggers: ["workspace macro"],
    source: "custom",
    category: "custom",
    activation_tags: [],
    execution_contract: {
      preferred_tools: [],
      durable_output_hints: [],
      output_modes: ["chat"],
      required_mcp_servers: [],
      template_ids: [],
    },
    availability: "available",
    availability_reasons: [],
  };

  assertEquals(
    selectRelevantSkills([customSkill], { conversation: ["Hello there"] }),
    [],
  );
});

Deno.test("skill prompt assembly - injects only activated skill contracts and points to introspection tools for the wider catalog", () => {
  const availableSkills: SkillCatalogEntry[] = [
    {
      ...withAvailability({
        id: "slides-author",
        name: "Slides Author",
        description: "Create presentation structures.",
        triggers: ["slides", "presentation"],
        source: "managed",
        category: "slides",
        locale: "en",
        activation_tags: ["slides"],
        execution_contract: {
          preferred_tools: ["create_artifact"],
          durable_output_hints: ["artifact"],
          output_modes: ["chat", "artifact"],
          required_mcp_servers: [],
          template_ids: ["slides-outline"],
        },
      }),
    },
    {
      ...withAvailability({
        id: "custom-notes",
        name: "Team Notes",
        description: "Weekly update formatter.",
        triggers: ["weekly update"],
        source: "custom",
        category: "custom",
        execution_contract: {
          preferred_tools: [],
          durable_output_hints: [],
          output_modes: ["chat"],
          required_mcp_servers: [],
          template_ids: [],
        },
      }),
    },
  ];
  const activatedSkills = activateSelectedSkills(
    [
      {
        skill: {
          ...availableSkills[0],
          instructions: "Build a slide-by-slide outline.",
        },
        score: 12,
        reasons: ['thread title matched trigger "slides"'],
      },
    ],
    100_000,
    50_000,
  );

  const prompt = buildSkillEnhancedPrompt("Base prompt.", {
    locale: "en",
    availableSkills,
    selectableSkills: availableSkills,
    selectedSkills: [
      {
        skill: activatedSkills[0],
        score: 12,
        reasons: ['thread title matched trigger "slides"'],
      },
    ],
    activatedSkills,
  });

  assertStringIncludes(prompt, "## Manual Reference");
  assertStringIncludes(prompt, "## Manual Details");
  assertStringIncludes(prompt, "Preferred tools");
  assertStringIncludes(prompt, "Build a slide-by-slide outline.");
  assert(!prompt.includes("## Available Skills"));
  assert(!prompt.includes("Weekly update formatter.\n**Instructions:**"));
});

Deno.test("skill prompt builder does not inject manuals before explicit activation", () => {
  const prompt = buildSkillEnhancedPrompt("Base prompt.", {
    locale: "en",
    availableSkills: [
      {
        id: "research-brief",
        name: "Research Brief",
        description: "Research workflow manual.",
        triggers: ["research"],
        source: "managed",
        category: "research",
        execution_contract: contract({
          preferred_tools: ["web_fetch"],
          output_modes: ["chat"],
          required_mcp_servers: [],
          template_ids: [],
        }),
        availability: "available",
        availability_reasons: [],
      },
    ],
    selectableSkills: [],
    selectedSkills: [],
    activatedSkills: [],
  });

  assertEquals(prompt, "Base prompt.");
});

Deno.test("managed skill catalog surface - returns summary data from the list surface and reserves instructions for describe", async () => {
  const catalogDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => [],
          }),
        }),
      }),
    }),
    insert: () => catalogDb,
    update: () => catalogDb,
    delete: () => catalogDb,
  } as unknown as D1Database;
  const catalog = await listManagedSkillsCatalog(catalogDb, "ws-1", {
    preferredLocale: "en",
  });
  assertEquals(catalog.locale, "en");
  assert(!("instructions" in catalog.skills[0]));
  assert(catalog.skills[0]?.execution_contract?.preferred_tools.length > 0);
  assertEquals(catalog.skills[0]?.availability, "available");
});
