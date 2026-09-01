import { test } from "bun:test";
import { assert, assertFalse } from "@takos/test/assert";
import {
  createSkillSchema,
  decodeSkillReference,
  patchSkillSchema,
  updateSkillSchema,
} from "../skills-shared.ts";
import { MAX_CUSTOM_SKILL_INSTRUCTION_BYTES } from "../../../shared/types/skills.ts";
import { MAX_PER_SKILL_INSTRUCTION_BYTES } from "../../../application/services/agent/skill-loader.ts";

test("custom Skill writes are strict, bounded, and clearable", () => {
  assert(createSkillSchema.safeParse({
    name: "quality-review",
    description: null,
    instructions: "Run the complete gate.",
    triggers: ["quality"],
    metadata: null,
  }).success);
  assert(updateSkillSchema.safeParse({
    description: null,
    metadata: null,
    triggers: [],
  }).success);
  assertFalse(createSkillSchema.safeParse({
    name: "quality-review",
    instructions: "valid",
    forged: true,
  }).success);
  assertFalse(patchSkillSchema.safeParse({}).success);
  assertFalse(patchSkillSchema.safeParse({ enabled: true, forged: true }).success);
  assertFalse(updateSkillSchema.safeParse({}).success);
});

test("custom Skill route references reject malformed escapes and bounds", () => {
  assert(decodeSkillReference("quality%20review", "name", 200) === "quality review");
  let malformedRejected = false;
  try {
    decodeSkillReference("quality%ZZreview", "name", 200);
  } catch {
    malformedRejected = true;
  }
  assert(malformedRejected);
});

test("persisted Skill instructions cannot exceed the runtime activation budget", () => {
  assert(MAX_CUSTOM_SKILL_INSTRUCTION_BYTES === MAX_PER_SKILL_INSTRUCTION_BYTES);
  assertFalse(createSkillSchema.safeParse({
    name: "oversized",
    instructions: "あ".repeat(MAX_CUSTOM_SKILL_INSTRUCTION_BYTES),
  }).success);
  assert(createSkillSchema.safeParse({
    name: "bounded",
    instructions: "a".repeat(MAX_CUSTOM_SKILL_INSTRUCTION_BYTES),
  }).success);
});

test("custom Skill trigger and metadata lists reject unbounded or malformed input", () => {
  assertFalse(createSkillSchema.safeParse({
    name: "too-many-triggers",
    instructions: "valid",
    triggers: Array.from({ length: 21 }, (_, index) => `trigger-${index}`),
  }).success);
  assertFalse(createSkillSchema.safeParse({
    name: "malformed-metadata",
    instructions: "valid",
    metadata: { activation_tags: ["valid", { forged: true }] },
  }).success);
});
