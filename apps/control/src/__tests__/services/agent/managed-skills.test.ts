import {
  CATEGORY_LABELS,
  getCategoryLabel,
  getManagedSkillById,
  isSkillLocale,
  listLocalizedManagedSkills,
  listManagedSkillDefinitions,
  localizeManagedSkill,
  normalizeCustomSkillMetadata,
  resolveSkillLocale,
  validateCustomSkillMetadata,
} from "@/services/agent/managed-skills";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

Deno.test("listManagedSkillDefinitions - returns all managed skills with unique IDs", () => {
  const skills = listManagedSkillDefinitions();
  const ids = skills.map((s) => s.id);
  assertEquals(new Set(ids).size, ids.length);
  assert(ids.includes("research-brief"));
  assert(ids.includes("writing-draft"));
  assert(ids.includes("planning-structurer"));
  assert(ids.includes("slides-author"));
  assert(ids.includes("repo-app-operator"));
});
Deno.test("listManagedSkillDefinitions - returns deep clones of the definitions", () => {
  const first = listManagedSkillDefinitions();
  const second = listManagedSkillDefinitions();
  first[0].activation_tags.push("injected");
  assert(!second[0].activation_tags.includes("injected"));
});
Deno.test("listManagedSkillDefinitions - every skill has both ja and en locales", () => {
  const skills = listManagedSkillDefinitions();
  for (const skill of skills) {
    assert(skill.locales.ja.triggers.length > 0);
    assert(skill.locales.en.triggers.length > 0);
    assert(skill.locales.ja.name);
    assert(skill.locales.en.name);
    assert(skill.locales.ja.instructions);
    assert(skill.locales.en.instructions);
  }
});
Deno.test("listManagedSkillDefinitions - every skill has a valid execution contract", () => {
  const skills = listManagedSkillDefinitions();
  for (const skill of skills) {
    assert(skill.execution_contract.output_modes.length > 0);
    assert(skill.execution_contract.preferred_tools.length > 0);
  }
});

Deno.test("listLocalizedManagedSkills - returns skills in the requested locale", () => {
  const jaSkills = listLocalizedManagedSkills("ja");
  assertEquals(jaSkills.every((s) => s.locale === "ja"), true);
  assert(/[\u3000-\u9fff]/.test(jaSkills[0].name)); // contains CJK

  const enSkills = listLocalizedManagedSkills("en");
  assertEquals(enSkills.every((s) => s.locale === "en"), true);
  assert(/^[A-Za-z\s]+$/.test(enSkills[0].name));
});

Deno.test("getManagedSkillById - returns the skill for a valid id", () => {
  const skill = getManagedSkillById("slides-author", "en");
  assertNotEquals(skill, null);
  assertEquals(skill!.id, "slides-author");
  assertEquals(skill!.locale, "en");
  assertEquals(skill!.name, "Slides Author");
});
Deno.test("getManagedSkillById - returns null for an unknown id", () => {
  assertEquals(getManagedSkillById("nonexistent", "en"), null);
});

Deno.test("localizeManagedSkill - localizes to ja", () => {
  const definitions = listManagedSkillDefinitions();
  const localized = localizeManagedSkill(definitions[0], "ja");
  assertEquals(localized.locale, "ja");
  assertEquals(localized.name, definitions[0].locales.ja.name);
  assertEquals(localized.triggers, definitions[0].locales.ja.triggers);
});
Deno.test("localizeManagedSkill - localizes to en", () => {
  const definitions = listManagedSkillDefinitions();
  const localized = localizeManagedSkill(definitions[0], "en");
  assertEquals(localized.locale, "en");
  assertEquals(localized.name, definitions[0].locales.en.name);
});
Deno.test("localizeManagedSkill - returns a deep clone of execution_contract", () => {
  const definitions = listManagedSkillDefinitions();
  const localized = localizeManagedSkill(definitions[0], "en");
  localized.execution_contract.preferred_tools.push("injected");
  const fresh = localizeManagedSkill(definitions[0], "en");
  assert(!fresh.execution_contract.preferred_tools.includes("injected"));
});

Deno.test("isSkillLocale - returns true for ja and en", () => {
  assertEquals(isSkillLocale("ja"), true);
  assertEquals(isSkillLocale("en"), true);
});
Deno.test("isSkillLocale - returns false for other values", () => {
  assertEquals(isSkillLocale("fr"), false);
  assertEquals(isSkillLocale(null), false);
  assertEquals(isSkillLocale(undefined), false);
});

Deno.test("resolveSkillLocale - prefers explicit locale", () => {
  assertEquals(resolveSkillLocale({ preferredLocale: "ja" }), "ja");
  assertEquals(resolveSkillLocale({ preferredLocale: "en" }), "en");
});
Deno.test("resolveSkillLocale - falls back to acceptLanguage", () => {
  assertEquals(resolveSkillLocale({ acceptLanguage: "ja-JP,ja;q=0.9" }), "ja");
  assertEquals(resolveSkillLocale({ acceptLanguage: "en-US,en;q=0.9" }), "en");
});
Deno.test("resolveSkillLocale - detects Japanese from text samples", () => {
  assertEquals(resolveSkillLocale({ textSamples: ["スライドを作って"] }), "ja");
});
Deno.test("resolveSkillLocale - defaults to en when no signal", () => {
  assertEquals(resolveSkillLocale({}), "en");
  assertEquals(resolveSkillLocale(), "en");
});

Deno.test("normalizeCustomSkillMetadata - normalizes a complete valid metadata object", () => {
  const result = normalizeCustomSkillMetadata({
    locale: "ja",
    category: "research",
    activation_tags: ["tag1", "tag2"],
    execution_contract: {
      preferred_tools: ["tool1"],
      durable_output_hints: ["artifact"],
      output_modes: ["chat", "artifact"],
      required_mcp_servers: ["server1"],
      template_ids: ["tmpl1"],
    },
  });

  assertEquals(result.locale, "ja");
  assertEquals(result.category, "research");
  assertEquals(result.activation_tags, ["tag1", "tag2"]);
  assertEquals(result.execution_contract?.output_modes, ["chat", "artifact"]);
});
Deno.test("normalizeCustomSkillMetadata - returns empty object for non-object input", () => {
  assertEquals(normalizeCustomSkillMetadata(null), {});
  assertEquals(normalizeCustomSkillMetadata("string"), {});
  assertEquals(normalizeCustomSkillMetadata([1, 2]), {});
});
Deno.test("normalizeCustomSkillMetadata - filters invalid output modes and durable hints", () => {
  const result = normalizeCustomSkillMetadata({
    execution_contract: {
      output_modes: ["chat", "bogus", "artifact"],
      durable_output_hints: ["artifact", "invalid"],
    },
  });
  assertEquals(result.execution_contract?.output_modes, ["chat", "artifact"]);
  assertEquals(result.execution_contract?.durable_output_hints, ["artifact"]);
});
Deno.test("normalizeCustomSkillMetadata - ignores invalid locale and category", () => {
  const result = normalizeCustomSkillMetadata({
    locale: "fr",
    category: "invalid-cat",
  });
  assertEquals(result.locale, undefined);
  assertEquals(result.category, undefined);
});
Deno.test("normalizeCustomSkillMetadata - limits activation_tags to 20", () => {
  const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
  const result = normalizeCustomSkillMetadata({ activation_tags: tags });
  assertEquals(result.activation_tags!.length, 20);
});

Deno.test("validateCustomSkillMetadata - returns no errors for valid input", () => {
  const { fieldErrors } = validateCustomSkillMetadata({
    locale: "en",
    category: "writing",
  });
  assertEquals(Object.keys(fieldErrors).length, 0);
});
Deno.test("validateCustomSkillMetadata - reports errors for invalid locale", () => {
  const { fieldErrors } = validateCustomSkillMetadata({ locale: 123 });
  assert(fieldErrors.locale !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports errors for invalid category", () => {
  const { fieldErrors } = validateCustomSkillMetadata({ category: "invalid" });
  assert(fieldErrors.category !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports error for non-object metadata", () => {
  const { fieldErrors } = validateCustomSkillMetadata("string");
  assert(fieldErrors.metadata !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports error for non-array activation_tags", () => {
  const { fieldErrors } = validateCustomSkillMetadata({
    activation_tags: "not-array",
  });
  assert(fieldErrors.activation_tags !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports error for non-object execution_contract", () => {
  const { fieldErrors } = validateCustomSkillMetadata({
    execution_contract: "bad",
  });
  assert(fieldErrors.execution_contract !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports error for invalid durable_output_hints values", () => {
  const { fieldErrors } = validateCustomSkillMetadata({
    execution_contract: { durable_output_hints: ["invalid"] },
  });
  assert(fieldErrors["execution_contract.durable_output_hints"] !== undefined);
});
Deno.test("validateCustomSkillMetadata - reports error for invalid output_modes values", () => {
  const { fieldErrors } = validateCustomSkillMetadata({
    execution_contract: { output_modes: ["bogus"] },
  });
  assert(fieldErrors["execution_contract.output_modes"] !== undefined);
});

Deno.test("getCategoryLabel - returns labels for all known categories", () => {
  assertEquals(getCategoryLabel("research").label, "Research");
  assertEquals(getCategoryLabel("writing").label, "Writing");
  assertEquals(getCategoryLabel("planning").label, "Planning");
  assertEquals(getCategoryLabel("slides").label, "Slides");
  assertEquals(getCategoryLabel("software").label, "Software");
  assertEquals(getCategoryLabel("custom").label, "Custom");
});
Deno.test("getCategoryLabel - returns custom label for unknown category", () => {
  // Cast to bypass type safety to test fallback
  assertEquals(getCategoryLabel("unknown" as "custom").label, "Custom");
});

Deno.test("CATEGORY_LABELS - contains entries for all managed categories plus custom", () => {
  assertEquals(
    Object.keys(CATEGORY_LABELS),
    ["research", "writing", "planning", "slides", "software", "custom"],
  );
});
