import type {
  ToolDefinition,
  ToolHandler,
  ToolParameter,
} from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";
import {
  createSkill,
  deleteSkillByName,
  formatSkill,
  getSkill,
  getSkillByName,
  listSkills,
  updateSkill,
  updateSkillEnabled,
} from "../../services/source/skills.ts";
import { normalizeSkillOutputMode } from "../../services/agent/skill-contracts.ts";

const SKILL_OUTPUT_MODE_SCHEMA_ENUM = [
  "chat",
  "text",
  "structured",
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
].filter((mode) => normalizeSkillOutputMode(mode)) as string[];

const SKILL_METADATA_SCHEMA: ToolParameter = {
  type: "object",
  description:
    "Optional structured metadata for skill selection and execution planning.",
  properties: {
    locale: {
      type: "string",
      enum: ["ja", "en"] as string[],
      description: "Preferred locale for this custom skill.",
    },
    category: {
      type: "string",
      enum: [
        "research",
        "writing",
        "planning",
        "slides",
        "software",
      ] as string[],
      description: "Optional category hint for resolver scoring.",
    },
    activation_tags: {
      type: "array",
      description:
        "Optional activation tags that help the resolver match this skill.",
      items: { type: "string", description: "Activation tag" },
    },
    execution_contract: {
      type: "object",
      description:
        "Optional execution contract hints for preferred tools and durable outputs.",
      properties: {
        preferred_tools: {
          type: "array",
          description: "Preferred tools for this skill.",
          items: { type: "string", description: "Preferred tool name" },
        },
        durable_output_hints: {
          type: "array",
          description:
            "Durable outputs this skill prefers to create or update.",
          items: {
            type: "string",
            enum: [
              "artifact",
              "reminder",
              "repo",
              "app",
              "workspace_file",
            ] as string[],
            description: "Durable output hint",
          },
        },
        output_modes: {
          type: "array",
          description:
            "Output modes this skill can satisfy. text and structured are accepted aliases for chat.",
          items: {
            type: "string",
            enum: SKILL_OUTPUT_MODE_SCHEMA_ENUM,
            description: "Output mode",
          },
        },
        required_mcp_servers: {
          type: "array",
          description: "Required MCP server names.",
          items: { type: "string", description: "Required MCP server name" },
        },
        template_ids: {
          type: "array",
          description: "Template identifiers associated with this skill.",
          items: { type: "string", description: "Template identifier" },
        },
      },
    },
  },
};

export const SKILL_LIST: ToolDefinition = {
  name: "skill_list",
  description: "List custom skills configured for this Workspace.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "none",
  side_effects: false,
  tool_class: "space_mapped",
  operation_id: "skill.list",
  parameters: {
    type: "object",
    properties: {},
  },
};

export const SKILL_GET: ToolDefinition = {
  name: "skill_get",
  description: "Get a custom skill in this Workspace by id.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "none",
  side_effects: false,
  tool_class: "space_mapped",
  operation_id: "skill.get",
  parameters: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "Skill id",
      },
    },
    required: ["skill_id"],
  },
};

export const SKILL_CREATE: ToolDefinition = {
  name: "skill_create",
  description: "Create a new custom skill in this Workspace.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "low",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "skill.create",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill name",
      },
      description: {
        type: "string",
        description: "Optional skill description",
      },
      instructions: {
        type: "string",
        description: "Skill instructions",
      },
      triggers: {
        type: "array",
        description: "Optional trigger phrases",
        items: {
          type: "string",
          description: "Trigger phrase",
        },
      },
      metadata: SKILL_METADATA_SCHEMA,
    },
    required: ["name", "instructions"],
  },
};

export const SKILL_UPDATE: ToolDefinition = {
  name: "skill_update",
  description: "Update an existing custom skill in this Workspace by id.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "low",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "skill.update",
  parameters: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "Existing skill id",
      },
      name: {
        type: "string",
        description: "Updated skill name",
      },
      description: {
        type: "string",
        description: "Updated description",
      },
      instructions: {
        type: "string",
        description: "Updated instructions",
      },
      triggers: {
        type: "array",
        description: "Updated trigger phrases",
        items: {
          type: "string",
          description: "Trigger phrase",
        },
      },
      metadata: SKILL_METADATA_SCHEMA,
      enabled: {
        type: "boolean",
        description: "Updated enabled flag",
      },
    },
    required: ["skill_id"],
  },
};

export const SKILL_TOGGLE: ToolDefinition = {
  name: "skill_toggle",
  description: "Enable or disable a custom skill in this Workspace by id.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "low",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "skill.toggle",
  parameters: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "Skill id",
      },
      enabled: {
        type: "boolean",
        description: "Whether the skill should be enabled",
      },
    },
    required: ["skill_id", "enabled"],
  },
};

export const SKILL_DELETE: ToolDefinition = {
  name: "skill_delete",
  description: "Delete a custom skill in this Workspace by id.",
  category: "space",
  namespace: "workspace.skills",
  family: "workspace.skills.ops",
  risk_level: "medium",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "skill.delete",
  parameters: {
    type: "object",
    properties: {
      skill_id: {
        type: "string",
        description: "Skill id",
      },
    },
    required: ["skill_id"],
  },
};

export const skillListHandler: ToolHandler = async (_args, context) => {
  const skills = await listSkills(context.db, context.spaceId);
  return JSON.stringify(
    {
      skills,
      count: skills.length,
    },
    null,
    2,
  );
};

export const skillGetHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || "").trim();
  if (!skillId) {
    throw new Error("skill_id is required");
  }

  const skill = await getSkill(context.db, context.spaceId, skillId);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  return JSON.stringify(
    {
      skill: formatSkill(skill),
    },
    null,
    2,
  );
};

export const skillCreateHandler: ToolHandler = async (args, context) => {
  const name = String(args.name || "").trim();
  const instructions = String(args.instructions || "").trim();

  if (!name) {
    throw new Error("name is required");
  }
  if (!instructions) {
    throw new Error("instructions is required");
  }

  const existing = await getSkillByName(context.db, context.spaceId, name);
  if (existing) {
    throw new Error(`Skill already exists: ${name}`);
  }

  const skill = await createSkill(context.db, context.spaceId, {
    name,
    description: args.description as string | undefined,
    instructions,
    triggers: Array.isArray(args.triggers)
      ? args.triggers.map((trigger) => String(trigger))
      : undefined,
    metadata: args.metadata as Record<string, unknown> | undefined,
  });

  return JSON.stringify(
    {
      skill: skill ? formatSkill(skill) : null,
    },
    null,
    2,
  );
};

export const skillUpdateHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || "").trim();
  if (!skillId) {
    throw new Error("skill_id is required");
  }

  const updateInput = {
    name: args.name as string | undefined,
    description: args.description as string | undefined,
    instructions: args.instructions as string | undefined,
    triggers: Array.isArray(args.triggers)
      ? args.triggers.map((trigger) => String(trigger))
      : undefined,
    metadata: args.metadata as Record<string, unknown> | undefined,
    enabled: args.enabled as boolean | undefined,
  };
  const updated = await updateSkill(
    context.db,
    context.spaceId,
    skillId,
    updateInput,
  );

  if (!updated) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  return JSON.stringify(
    {
      skill: formatSkill(updated),
    },
    null,
    2,
  );
};

export const skillToggleHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || "").trim();
  if (!skillId) {
    throw new Error("skill_id is required");
  }

  const enabled = args.enabled === true;
  const existing = await getSkill(context.db, context.spaceId, skillId);
  if (!existing) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  await updateSkillEnabled(context.db, skillId, enabled);

  return JSON.stringify(
    {
      success: true,
      skill_id: skillId,
      enabled,
    },
    null,
    2,
  );
};

export const skillDeleteHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || "").trim();
  if (!skillId) {
    throw new Error("skill_id is required");
  }

  const existing = await getSkill(context.db, context.spaceId, skillId);
  if (!existing) {
    throw new Error(`Skill not found: ${skillId}`);
  }
  await deleteSkillByName(context.db, context.spaceId, existing.name);

  return JSON.stringify(
    {
      success: true,
      skill_id: skillId,
    },
    null,
    2,
  );
};

export const {
  tools: WORKSPACE_SKILL_TOOLS,
  handlers: WORKSPACE_SKILL_HANDLERS,
} = defineTools([
  [SKILL_LIST, skillListHandler],
  [SKILL_GET, skillGetHandler],
  [SKILL_CREATE, skillCreateHandler],
  [SKILL_UPDATE, skillUpdateHandler],
  [SKILL_TOGGLE, skillToggleHandler],
  [SKILL_DELETE, skillDeleteHandler],
]);
