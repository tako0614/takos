import {
  buildSkillTree,
  searchSkillsByText,
} from "@/services/source/skill-search";
import type { SkillCatalogEntry } from "@/services/agent/skills";

import { assert, assertEquals } from "jsr:@std/assert";

function makeSkill(
  overrides: Partial<SkillCatalogEntry> & { id: string; name: string },
): SkillCatalogEntry {
  return {
    description: "",
    triggers: [],
    source: "managed",
    category: "custom",
    version: "1.0.0",
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

const MANAGED_SKILLS: SkillCatalogEntry[] = [
  makeSkill({
    id: "research-brief",
    name: "Research Brief",
    category: "research",
    source: "managed",
    description: "Investigate a topic",
    triggers: ["research", "analyze"],
  }),
  makeSkill({
    id: "writing-draft",
    name: "Writing Draft",
    category: "writing",
    source: "managed",
    description: "Turn rough intent into a draft",
    triggers: ["write", "draft"],
  }),
  makeSkill({
    id: "planning-structurer",
    name: "Planning Structurer",
    category: "planning",
    source: "managed",
    description: "Clarify goals",
    triggers: ["plan", "roadmap"],
  }),
  makeSkill({
    id: "slides-author",
    name: "Slides Author",
    category: "slides",
    source: "managed",
    description: "Design slide decks",
    triggers: ["slides"],
  }),
  makeSkill({
    id: "repo-app-operator",
    name: "Repo App Operator",
    category: "software",
    source: "managed",
    description: "Software asset management",
    triggers: ["repo", "deploy"],
  }),
];

const CUSTOM_SKILLS: SkillCatalogEntry[] = [
  makeSkill({
    id: "custom-1",
    name: "my-translator",
    category: "custom",
    source: "custom",
    description: "Translation skill",
    triggers: ["translate"],
  }),
  makeSkill({
    id: "custom-2",
    name: "data-analyzer",
    category: "custom",
    source: "custom",
    description: "Data analysis",
    triggers: ["analyze"],
  }),
];

const ALL_SKILLS = [...MANAGED_SKILLS, ...CUSTOM_SKILLS];

Deno.test("buildSkillTree - groups skills by category in canonical order", () => {
  const tree = buildSkillTree(ALL_SKILLS);

  assertEquals(tree.total_skills, ALL_SKILLS.length);

  const categories = tree.categories.map((c) => c.category);
  assertEquals(categories, [
    "research",
    "writing",
    "planning",
    "slides",
    "software",
    "custom",
  ]);
});
Deno.test("buildSkillTree - uses correct labels", () => {
  const tree = buildSkillTree(ALL_SKILLS);
  assertEquals(tree.categories[0].label, "Research");
  assertEquals(tree.categories[5].label, "Custom");
});
Deno.test("buildSkillTree - omits empty categories", () => {
  const tree = buildSkillTree(MANAGED_SKILLS);
  const categories = tree.categories.map((c) => c.category);
  assert(!categories.includes("custom"));
  assertEquals(tree.total_skills, 5);
});
Deno.test("buildSkillTree - places skills with matching category under the correct node", () => {
  const tree = buildSkillTree(ALL_SKILLS);
  const customNode = tree.categories.find((c) => c.category === "custom");
  assert(customNode !== undefined);
  assertEquals(customNode!.skills.length, 2);
  assertEquals(customNode!.skills.map((s) => s.id), ["custom-1", "custom-2"]);
});
Deno.test("buildSkillTree - handles empty skill list", () => {
  const tree = buildSkillTree([]);
  assertEquals(tree.categories.length, 0);
  assertEquals(tree.total_skills, 0);
});

Deno.test("searchSkillsByText - returns exact name match with highest score", () => {
  const results = searchSkillsByText(ALL_SKILLS, "Research Brief");
  assert(results.length >= 1);
  assertEquals(results[0].skill.id, "research-brief");
  assertEquals(results[0].score, 100);
  assertEquals(results[0].match_source, "text");
});
Deno.test("searchSkillsByText - returns partial name matches", () => {
  const results = searchSkillsByText(ALL_SKILLS, "Draft");
  assertEquals(results.some((r) => r.skill.id === "writing-draft"), true);
  const match = results.find((r) => r.skill.id === "writing-draft")!;
  assertEquals(match.score, 60);
});
Deno.test("searchSkillsByText - matches triggers", () => {
  const results = searchSkillsByText(ALL_SKILLS, "translate");
  assertEquals(results.some((r) => r.skill.id === "custom-1"), true);
  const match = results.find((r) => r.skill.id === "custom-1")!;
  assertEquals(match.score, 50);
});
Deno.test("searchSkillsByText - matches description", () => {
  const results = searchSkillsByText(ALL_SKILLS, "Design slide decks");
  assertEquals(results.some((r) => r.skill.id === "slides-author"), true);
});
Deno.test("searchSkillsByText - matches category label", () => {
  const results = searchSkillsByText(ALL_SKILLS, "software");
  assertEquals(results.some((r) => r.skill.id === "repo-app-operator"), true);
  const match = results.find((r) => r.skill.id === "repo-app-operator")!;
  // description contains "Software" (score 40) which is higher than category match (30)
  assert(match.score >= 30);
});
Deno.test("searchSkillsByText - returns empty for non-matching query", () => {
  const results = searchSkillsByText(ALL_SKILLS, "zzz-no-match-xyz");
  assertEquals(results.length, 0);
});
Deno.test("searchSkillsByText - respects limit option", () => {
  const results = searchSkillsByText(ALL_SKILLS, "analyze", { limit: 1 });
  assertEquals(results.length, 1);
});
Deno.test("searchSkillsByText - sorts by score descending", () => {
  const results = searchSkillsByText(ALL_SKILLS, "analyze");
  for (let i = 1; i < results.length; i++) {
    assert(results[i - 1].score >= results[i].score);
  }
});
