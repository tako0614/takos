import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { scoreSkill, selectRelevantSkills } from "../skill-scoring.ts";
import type {
  SkillContext,
  SkillResolutionContext,
  SkillSelection,
} from "../skill-resolution.ts";

function makeSkill(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    id: "skill",
    name: "skill",
    description: "Test skill",
    instructions: "Test instructions",
    triggers: [],
    source: "managed",
    category: "custom",
    locale: "en",
    version: "1",
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
    ...overrides,
  };
}

function sortSelections(selections: SkillSelection[]): SkillSelection[] {
  return selections.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.skill.priority ?? 0) - (a.skill.priority ?? 0);
  });
}

test("selectRelevantSkills shares delegation extraction while scoreSkill stays independent", () => {
  let delegationReads = 0;
  const delegation = {
    task: "research the repository",
    goal: "prepare a report",
    deliverable: "report",
    context: ["repository"],
    acceptance_criteria: ["include sources"],
    product_hint: "takos",
    locale: "en",
    parent_run_id: "run-1",
    parent_thread_id: "thread-1",
    root_thread_id: "root-1",
  };
  const runInput: Record<string, unknown> = {
    get delegation() {
      delegationReads += 1;
      return delegation;
    },
  };
  const input: SkillResolutionContext = {
    conversation: [],
    runInput,
    agentType: "researcher",
    maxSelected: 1,
  };
  const skills = [
    makeSkill({
      id: "research",
      name: "research brief",
      triggers: ["research"],
      activation_tags: ["report"],
      category: "research",
      priority: 1,
    }),
    makeSkill({
      id: "repository",
      name: "repository operator",
      triggers: ["repository"],
      category: "software",
    }),
    makeSkill({
      id: "unavailable",
      name: "unavailable research",
      triggers: ["research"],
      availability: "unavailable",
    }),
  ];

  const directSelections = skills
    .filter((skill) => skill.availability !== "unavailable")
    .map((skill) => scoreSkill(skill, input))
    .filter((selection): selection is SkillSelection => selection !== null);
  assertEquals(delegationReads, 2);
  assertEquals(directSelections.length, 2);

  delegationReads = 0;
  const selected = selectRelevantSkills(skills, input);
  assertEquals(delegationReads, 1);

  const expected = sortSelections(directSelections.slice()).slice(
    0,
    input.maxSelected,
  );
  assertEquals(selected, expected);
});

test("scoreSkill and selectRelevantSkills return no selection without context segments", () => {
  const skill = makeSkill({ triggers: ["research"] });
  const input: SkillResolutionContext = { conversation: [] };

  assertEquals(scoreSkill(skill, input), null);
  assertEquals(selectRelevantSkills([skill], input), []);
});
