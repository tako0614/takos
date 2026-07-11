import { expect, test } from "bun:test";

import {
  MAX_PER_SKILL_INSTRUCTION_BYTES,
  MAX_TOTAL_SKILL_INSTRUCTION_BYTES,
} from "../skill-loader.ts";
import {
  activateSelectedSkills,
  type SkillSelection,
} from "../skill-resolution.ts";

function selection(id: string, instructions: string): SkillSelection {
  return {
    score: 1,
    reasons: ["test"],
    skill: {
      id,
      name: id,
      description: id,
      instructions,
      triggers: [],
      source: "custom",
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
    },
  } as SkillSelection;
}

test("skill activation enforces UTF-8 bytes inside the shared model reserve", () => {
  const multibyte = selection("multibyte", "あ".repeat(2_000));
  expect(
    activateSelectedSkills(
      [multibyte],
      MAX_TOTAL_SKILL_INSTRUCTION_BYTES,
      MAX_PER_SKILL_INSTRUCTION_BYTES,
    ),
  ).toHaveLength(0);

  const selected = activateSelectedSkills(
    [
      selection("one", "a".repeat(4_000)),
      selection("two", "b".repeat(4_000)),
      selection("three", "c".repeat(4_000)),
    ],
    MAX_TOTAL_SKILL_INSTRUCTION_BYTES,
    MAX_PER_SKILL_INSTRUCTION_BYTES,
  );
  expect(selected.map((skill) => skill.id)).toEqual(["one", "two"]);
});
