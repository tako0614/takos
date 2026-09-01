import {
  MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
  MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
  MAX_CUSTOM_SKILL_NAME_CHARACTERS,
  MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
  MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS,
  MAX_CUSTOM_SKILL_TRIGGERS,
} from "takos-api-contract/shared/types";
import type {
  ManagedSkill,
  Skill,
  SkillResourceTemplate,
} from "../../types/index.ts";

const MAX_SKILLS_PER_LIST = 200;
const MAX_RESOURCE_TEMPLATES_PER_LIST = 64;
const MAX_VERSION_CHARACTERS = 64;
const MAX_AVAILABILITY_REASON_CHARACTERS = 4_000;
const SKILL_LOCALES = new Set(["ja", "en"]);
const SKILL_CATEGORIES = new Set([
  "research",
  "writing",
  "planning",
  "slides",
  "software",
]);
const DURABLE_OUTPUT_HINTS = new Set([
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
]);
const OUTPUT_MODES = new Set([
  "chat",
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
]);
const AVAILABILITY = new Set(["available", "warning", "unavailable"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maxCharacters ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Invalid Skill ${field}`);
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string | null {
  return value === null
    ? null
    : boundedString(value, field, maxCharacters, true);
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid Skill ${field}`);
  }
  return text;
}

function stringList(
  value: unknown,
  field: string,
  maxItems = MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
  maxCharacters = MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
  allowed?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`Invalid Skill ${field}`);
  }
  return value.map((item) => {
    const text = boundedString(item, field, maxCharacters);
    if (allowed && !allowed.has(text)) {
      throw new TypeError(`Invalid Skill ${field}`);
    }
    return text;
  });
}

function executionContract(value: unknown, field: string) {
  const candidate = record(value);
  if (!candidate) throw new TypeError(`Invalid Skill ${field}`);
  return {
    preferred_tools: stringList(
      candidate.preferred_tools,
      `${field}.preferred_tools`,
    ),
    durable_output_hints: stringList(
      candidate.durable_output_hints,
      `${field}.durable_output_hints`,
      MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
      MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
      DURABLE_OUTPUT_HINTS,
    ),
    output_modes: stringList(
      candidate.output_modes,
      `${field}.output_modes`,
      MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
      MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
      OUTPUT_MODES,
    ),
    required_mcp_servers: stringList(
      candidate.required_mcp_servers,
      `${field}.required_mcp_servers`,
    ),
    template_ids: stringList(candidate.template_ids, `${field}.template_ids`),
  };
}

function parseCustomMetadata(value: unknown): NonNullable<Skill["metadata"]> {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Skill metadata");
  if (
    candidate.locale !== undefined &&
    !SKILL_LOCALES.has(candidate.locale as string)
  ) {
    throw new TypeError("Invalid Skill metadata.locale");
  }
  if (
    candidate.category !== undefined &&
    !SKILL_CATEGORIES.has(candidate.category as string)
  ) {
    throw new TypeError("Invalid Skill metadata.category");
  }
  return {
    ...(candidate.locale !== undefined
      ? { locale: candidate.locale as "ja" | "en" }
      : {}),
    ...(candidate.category !== undefined
      ? {
        category: candidate.category as NonNullable<
          NonNullable<Skill["metadata"]>["category"]
        >,
      }
      : {}),
    activation_tags: stringList(
      candidate.activation_tags,
      "metadata.activation_tags",
    ),
    execution_contract: executionContract(
      candidate.execution_contract,
      "metadata.execution_contract",
    ),
  };
}

export function parseCustomSkill(value: unknown): Skill {
  const candidate = record(value);
  if (
    !candidate || candidate.source !== "custom" ||
    candidate.editable !== true || typeof candidate.enabled !== "boolean"
  ) {
    throw new TypeError("Invalid custom Skill response item");
  }
  const instructions = boundedString(
    candidate.instructions,
    "instructions",
    MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  );
  if (
    new TextEncoder().encode(instructions).byteLength >
      MAX_CUSTOM_SKILL_INSTRUCTION_BYTES
  ) {
    throw new TypeError("Invalid Skill instructions");
  }
  return {
    id: boundedString(
      candidate.id,
      "id",
      MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
    ),
    name: boundedString(
      candidate.name,
      "name",
      MAX_CUSTOM_SKILL_NAME_CHARACTERS,
    ),
    description: nullableBoundedString(
      candidate.description,
      "description",
      MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
    ),
    instructions,
    triggers: stringList(
      candidate.triggers,
      "triggers",
      MAX_CUSTOM_SKILL_TRIGGERS,
      MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS,
    ),
    metadata: parseCustomMetadata(candidate.metadata),
    source: "custom",
    editable: true,
    enabled: candidate.enabled,
    created_at: timestamp(candidate.created_at, "created_at"),
    updated_at: timestamp(candidate.updated_at, "updated_at"),
  };
}

function parseManagedSkill(value: unknown, locale: "ja" | "en"): ManagedSkill {
  const candidate = record(value);
  if (
    !candidate || candidate.source !== "managed" ||
    candidate.editable !== false || candidate.enabled !== true ||
    candidate.locale !== locale ||
    !SKILL_CATEGORIES.has(candidate.category as string) ||
    !AVAILABILITY.has(candidate.availability as string)
  ) {
    throw new TypeError("Invalid managed Skill response item");
  }
  return {
    id: boundedString(
      candidate.id,
      "managed.id",
      MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
    ),
    version: boundedString(
      candidate.version,
      "managed.version",
      MAX_VERSION_CHARACTERS,
    ),
    name: boundedString(
      candidate.name,
      "managed.name",
      MAX_CUSTOM_SKILL_NAME_CHARACTERS,
    ),
    description: boundedString(
      candidate.description,
      "managed.description",
      MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
    ),
    triggers: stringList(
      candidate.triggers,
      "managed.triggers",
      MAX_CUSTOM_SKILL_TRIGGERS,
      MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS,
    ),
    source: "managed",
    editable: false,
    enabled: true,
    category: candidate.category as string,
    locale,
    availability: candidate.availability as NonNullable<
      ManagedSkill["availability"]
    >,
    availability_reasons: stringList(
      candidate.availability_reasons,
      "managed.availability_reasons",
      MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
      MAX_AVAILABILITY_REASON_CHARACTERS,
    ),
    activation_tags: stringList(
      candidate.activation_tags,
      "managed.activation_tags",
    ),
    execution_contract: executionContract(
      candidate.execution_contract,
      "managed.execution_contract",
    ),
  };
}

function uniqueIds<T extends { id: string }>(items: T[], label: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new TypeError(`Duplicate ${label} ids`);
  }
  return items;
}

function parseSkillResourceTemplate(value: unknown): SkillResourceTemplate {
  const candidate = record(value);
  if (
    !candidate || candidate.media_type !== "text/markdown" ||
    candidate.content !== undefined
  ) {
    throw new TypeError("Invalid Skill resource template");
  }
  return {
    id: boundedString(
      candidate.id,
      "resource_template.id",
      MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
    ),
    title: boundedString(
      candidate.title,
      "resource_template.title",
      MAX_CUSTOM_SKILL_NAME_CHARACTERS,
    ),
    description: boundedString(
      candidate.description,
      "resource_template.description",
      MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
    ),
    media_type: "text/markdown",
  };
}

export function readCustomSkillListResponse(value: unknown): Skill[] {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.skills) ||
    candidate.skills.length > MAX_SKILLS_PER_LIST
  ) {
    throw new TypeError("Invalid custom Skill list response");
  }
  return uniqueIds(candidate.skills.map(parseCustomSkill), "custom Skill");
}

export function readManagedSkillListResponse(value: unknown): ManagedSkill[] {
  return readManagedSkillCatalogResponse(value).skills;
}

export function readManagedSkillCatalogResponse(value: unknown): {
  skills: ManagedSkill[];
  resourceTemplates: SkillResourceTemplate[];
} {
  const candidate = record(value);
  if (
    !candidate || !SKILL_LOCALES.has(candidate.locale as string) ||
    !Array.isArray(candidate.skills) ||
    candidate.skills.length > MAX_SKILLS_PER_LIST ||
    (candidate.resource_templates !== undefined &&
      (!Array.isArray(candidate.resource_templates) ||
        candidate.resource_templates.length > MAX_RESOURCE_TEMPLATES_PER_LIST))
  ) {
    throw new TypeError("Invalid managed Skill list response");
  }
  const locale = candidate.locale as "ja" | "en";
  return {
    skills: uniqueIds(
      candidate.skills.map((item) => parseManagedSkill(item, locale)),
      "managed Skill",
    ),
    resourceTemplates: uniqueIds(
      (candidate.resource_templates ?? []).map(parseSkillResourceTemplate),
      "Skill resource template",
    ),
  };
}

export function readCustomSkillMutationResponse(
  value: unknown,
  expected: { id?: string; name: string },
): Skill {
  const candidate = record(value);
  const skill = parseCustomSkill(candidate?.skill);
  if (
    (expected.id !== undefined && skill.id !== expected.id) ||
    skill.name !== expected.name
  ) {
    throw new TypeError("Skill mutation response does not match the request");
  }
  return skill;
}

export function readSkillToggleResponse(
  value: unknown,
  expectedEnabled: boolean,
): void {
  const candidate = record(value);
  if (
    !candidate || candidate.success !== true ||
    candidate.enabled !== expectedEnabled
  ) {
    throw new TypeError("Invalid Skill toggle response");
  }
}

export function readSkillDeleteResponse(value: unknown): void {
  const candidate = record(value);
  if (!candidate || candidate.success !== true) {
    throw new TypeError("Invalid Skill delete response");
  }
}
