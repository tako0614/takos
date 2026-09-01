import { strictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import {
  getSkillInstructionByteLength,
  validateSkillResourceSelection,
} from "../../../views/agent/skill-form-utils.ts";

test("custom Skill instruction budget counts UTF-8 bytes", () => {
  assertEquals(getSkillInstructionByteLength("abc"), 3);
  assertEquals(getSkillInstructionByteLength("あ"), 3);
});

test("custom Skill resource selection rejects overflow and duplicates", () => {
  assertEquals(validateSkillResourceSelection(["a", "b"], 2), null);
  assertEquals(validateSkillResourceSelection(["a", "b", "c"], 2), "too_many");
  assertEquals(validateSkillResourceSelection(["a", "a"], 2), "duplicate");
});
