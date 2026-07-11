import type { ToolDefinition } from "./tool-definitions.ts";
import type {
  CapabilityDescriptor,
  CapabilityNamespace,
} from "./capability-types.ts";
import type { LocalizedManagedSkill } from "../services/agent/managed-skills.ts";
import type { SkillExecutionContract } from "../services/agent/skill-contracts.ts";

/** Derive tags from a tool's category + namespace metadata. */
function deriveToolTags(tool: ToolDefinition): string[] {
  const tags: string[] = [tool.category];
  if (tool.namespace) {
    tags.push(tool.namespace);
  }
  if (tool.family) {
    tags.push(tool.family);
  }
  if (tool.required_capabilities) {
    tags.push(...tool.required_capabilities);
  }
  return [...new Set(tags)];
}

/** Convert a ToolDefinition to a CapabilityDescriptor. */
export function buildToolDescriptor(
  tool: ToolDefinition,
): CapabilityDescriptor {
  const namespace = (tool.namespace as CapabilityNamespace | undefined) ??
    (tool.category as CapabilityNamespace);
  const family = tool.family;
  const risk_level = tool.risk_level ?? "none";
  const side_effects = tool.side_effects ?? false;
  return {
    id: `tool:${tool.name}`,
    kind: "tool",
    namespace,
    name: tool.name,
    summary: tool.description,
    tags: deriveToolTags(tool),
    family,
    risk_level,
    side_effects,
    required_roles: tool.required_roles,
    required_capabilities: tool.required_capabilities,
    source: "custom",
    discoverable: true,
    selectable: true,
  };
}

/** Convert a LocalizedManagedSkill to a CapabilityDescriptor. */
export function buildSkillDescriptor(
  skill: LocalizedManagedSkill,
): CapabilityDescriptor {
  return {
    id: `skill:${skill.id}`,
    kind: "skill",
    namespace: categoryToNamespace(skill.category),
    name: skill.name ?? skill.id,
    summary: skill.description ?? "",
    instructions: skill.instructions,
    recommended_tools: [...skill.execution_contract.preferred_tools],
    output_modes: [...skill.execution_contract.output_modes],
    durable_output_hints: [...skill.execution_contract.durable_output_hints],
    tags: [
      "manual",
      "workflow",
      "guide",
      "instructions",
      "取説",
      "手順",
      skill.category,
      ...skill.activation_tags,
      ...skill.execution_contract.preferred_tools,
      ...(skill.triggers ?? []).slice(0, 5),
    ],
    triggers: skill.triggers ?? [],
    family: `skill.${skill.category}`,
    risk_level: "none",
    side_effects: false,
    source: "managed_skill",
    discoverable: true,
    selectable: false,
  };
}

/** Convert a custom skill row (minimal shape) to a CapabilityDescriptor. */
export function buildCustomSkillDescriptor(skill: {
  id: string;
  name: string;
  description: string;
  instructions?: string;
  triggers?: string[];
  category?: string;
  activation_tags?: string[];
  execution_contract?: SkillExecutionContract;
}): CapabilityDescriptor {
  const triggers = skill.triggers ?? [];
  const contract = skill.execution_contract;
  return {
    id: `skill:${skill.id}`,
    kind: "skill",
    namespace: categoryToNamespace(skill.category),
    name: skill.name,
    summary: skill.description,
    instructions: skill.instructions,
    recommended_tools: [...(contract?.preferred_tools ?? [])],
    output_modes: [...(contract?.output_modes ?? [])],
    durable_output_hints: [...(contract?.durable_output_hints ?? [])],
    tags: [
      "manual",
      "workflow",
      "guide",
      "instructions",
      "取説",
      "手順",
      skill.category ?? "custom",
      ...(skill.activation_tags ?? []),
      ...(contract?.preferred_tools ?? []),
      ...triggers.slice(0, 5),
    ],
    triggers,
    family: `skill.${skill.category ?? "custom"}`,
    risk_level: "none",
    side_effects: false,
    source: "custom_skill",
    discoverable: true,
    selectable: false,
  };
}

function categoryToNamespace(category?: string): CapabilityNamespace {
  switch (category) {
    case "research":
      return "web";
    case "writing":
    case "planning":
    case "slides":
      return "artifact";
    case "software":
      return "repo";
    default:
      return "discovery";
  }
}
