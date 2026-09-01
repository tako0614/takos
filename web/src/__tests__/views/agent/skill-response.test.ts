import {
  deepStrictEqual as assertEquals,
  throws as assertThrows,
} from "node:assert/strict";
import { test } from "bun:test";
import {
  readCustomSkillListResponse,
  readCustomSkillMutationResponse,
  readManagedSkillCatalogResponse,
  readManagedSkillListResponse,
  readSkillDeleteResponse,
  readSkillToggleResponse,
} from "../../../views/agent/skill-response.ts";

const now = "2026-08-09T20:00:00.000Z";

function customSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    name: "quality-review",
    description: "Review quality gates",
    instructions: "Run the complete gate.",
    triggers: ["quality"],
    metadata: {
      activation_tags: ["quality"],
      execution_contract: {
        preferred_tools: ["toolbox"],
        durable_output_hints: ["artifact"],
        output_modes: ["chat", "artifact"],
        required_mcp_servers: [],
        template_ids: [],
      },
    },
    source: "custom",
    editable: true,
    enabled: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function managedSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "research-brief",
    version: "1.0.0",
    name: "Research Brief",
    description: "Gather evidence and summarize it.",
    triggers: ["research"],
    source: "managed",
    editable: false,
    enabled: true,
    category: "research",
    locale: "en",
    availability: "available",
    availability_reasons: [],
    activation_tags: ["research"],
    execution_contract: {
      preferred_tools: ["toolbox"],
      durable_output_hints: ["artifact"],
      output_modes: ["chat", "artifact"],
      required_mcp_servers: [],
      template_ids: ["research-brief"],
    },
    ...overrides,
  };
}

test("Skill list response parsers accept and project current contracts", () => {
  const custom = customSkill();
  const managed = managedSkill();
  assertEquals(readCustomSkillListResponse({ skills: [custom] }), [custom]);
  assertEquals(
    readManagedSkillListResponse({ locale: "en", skills: [managed] }),
    [
      managed,
    ],
  );
});

test("managed Skill catalog exposes bounded resource descriptors without content", () => {
  const managed = managedSkill();
  const resource = {
    id: "research-brief",
    title: "Research brief template",
    description: "Evidence-backed structure.",
    media_type: "text/markdown",
  };
  assertEquals(
    readManagedSkillCatalogResponse({
      locale: "en",
      skills: [managed],
      resource_templates: [resource],
    }),
    { skills: [managed], resourceTemplates: [resource] },
  );
  assertThrows(() =>
    readManagedSkillCatalogResponse({
      locale: "en",
      skills: [managed],
      resource_templates: [{ ...resource, content: "must not be trusted" }],
    })
  );
});

test("Skill list response parsers reject malformed and duplicate records", () => {
  assertThrows(() =>
    readCustomSkillListResponse({
      skills: [customSkill({ source: "managed" })],
    })
  );
  assertThrows(() =>
    readCustomSkillListResponse({
      skills: [customSkill({ instructions: "あ".repeat(1_366) })],
    })
  );
  assertThrows(() =>
    readCustomSkillListResponse({
      skills: [customSkill(), customSkill()],
    })
  );
  assertThrows(() =>
    readManagedSkillListResponse({
      locale: "ja",
      skills: [managedSkill()],
    })
  );
  assertThrows(() =>
    readManagedSkillListResponse({
      locale: "en",
      skills: [managedSkill({ availability: "forged" })],
    })
  );
});

test("Skill mutation responses must match the accepted operation", () => {
  const custom = customSkill();
  assertEquals(
    readCustomSkillMutationResponse(
      { skill: custom },
      { id: "skill-1", name: "quality-review" },
    ),
    custom,
  );
  assertThrows(() =>
    readCustomSkillMutationResponse(
      { skill: customSkill({ id: "skill-other" }) },
      { id: "skill-1", name: "quality-review" },
    )
  );
  readSkillToggleResponse({ success: true, enabled: false }, false);
  assertThrows(() =>
    readSkillToggleResponse({ success: true, enabled: true }, false)
  );
  readSkillDeleteResponse({ success: true });
  assertThrows(() => readSkillDeleteResponse({ success: false }));
});
