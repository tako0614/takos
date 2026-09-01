import type { ToolDefinition } from "./tool-definitions.ts";
import type {
  CapabilityDescriptor,
  CapabilityNamespace,
} from "./capability-types.ts";
import type { SkillContext } from "../services/agent/skill-resolution.ts";
import type { SkillResourceManifestEntry } from "../services/agent/skill-revisions.ts";

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
    required_capabilities: tool.required_capabilities,
    source: "custom",
    discoverable: true,
    selectable: true,
  };
}

/**
 * Convert one exact Run-pinned Skill revision to a descriptor.
 *
 * Instructions deliberately do not cross this seam. `toolbox describe`
 * activates the logical identity through the immutable Skill-plan module and
 * returns content only after the next RunContext revision commits.
 */
export function buildPinnedSkillDescriptor(
  skill: SkillContext,
  resourceManifest: readonly SkillResourceManifestEntry[] = [],
): CapabilityDescriptor {
  return {
    id: `skill:${skill.source}:${skill.id}`,
    kind: "skill",
    namespace: categoryToNamespace(skill.category),
    name: skill.name ?? skill.id,
    summary: skill.description ?? "",
    recommended_tools: [...skill.execution_contract.preferred_tools],
    output_modes: [...skill.execution_contract.output_modes],
    durable_output_hints: [...skill.execution_contract.durable_output_hints],
    resource_manifest: resourceManifest.map((resource) => ({ ...resource })),
    tags: [
      "manual",
      "workflow",
      "guide",
      "instructions",
      "取説",
      "手順",
      skill.category ?? "custom",
      ...skill.activation_tags,
      ...skill.execution_contract.preferred_tools,
      ...(skill.triggers ?? []).slice(0, 5),
    ],
    triggers: skill.triggers ?? [],
    family: `skill.${skill.category ?? "custom"}`,
    risk_level: "none",
    side_effects: false,
    source: skill.source === "managed" ? "managed_skill" : "custom_skill",
    discoverable: true,
    selectable: false,
    manual_identity: {
      source: skill.source,
      skill_id: skill.id,
    },
    availability: skill.availability,
    availability_reasons: [...skill.availability_reasons],
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
