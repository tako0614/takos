import type { ToolDefinition, ToolHandler, ToolParameter } from '../tool-definitions';
import {
  createSkill,
  describeAgentSkill,
  getSkill,
  deleteSkillByName,
  formatSkill,
  getSkillByName,
  listSkillCatalog,
  listSkillContext,
  listSkills,
  updateSkill,
  updateSkillEnabled,
  updateSkillByName,
  updateSkillEnabledByName,
} from '../../services/source/skills';
import { resolveSkillLocale } from '../../services/agent/official-skills';

const SKILL_METADATA_SCHEMA: ToolParameter = {
  type: 'object',
  description: 'Optional structured metadata for skill selection and execution planning.',
  properties: {
    locale: {
      type: 'string',
      enum: ['ja', 'en'] as string[],
      description: 'Preferred locale for this custom skill.',
    },
    category: {
      type: 'string',
      enum: ['research', 'writing', 'planning', 'slides', 'software'] as string[],
      description: 'Optional category hint for resolver scoring.',
    },
    activation_tags: {
      type: 'array',
      description: 'Optional activation tags that help the resolver match this skill.',
      items: { type: 'string', description: 'Activation tag' },
    },
    execution_contract: {
      type: 'object',
      description: 'Optional execution contract hints for preferred tools and durable outputs.',
      properties: {
        preferred_tools: {
          type: 'array',
          description: 'Preferred tools for this skill.',
          items: { type: 'string', description: 'Preferred tool name' },
        },
        durable_output_hints: {
          type: 'array',
          description: 'Durable outputs this skill prefers to create or update.',
          items: { type: 'string', enum: ['artifact', 'reminder', 'repo', 'app', 'workspace_file'] as string[], description: 'Durable output hint' },
        },
        output_modes: {
          type: 'array',
          description: 'Output modes this skill can satisfy.',
          items: { type: 'string', enum: ['chat', 'artifact', 'reminder', 'repo', 'app', 'workspace_file'] as string[], description: 'Output mode' },
        },
        required_mcp_servers: {
          type: 'array',
          description: 'Required MCP server names.',
          items: { type: 'string', description: 'Required MCP server name' },
        },
        template_ids: {
          type: 'array',
          description: 'Template identifiers associated with this skill.',
          items: { type: 'string', description: 'Template identifier' },
        },
      },
    },
  },
};

export const SKILL_LIST: ToolDefinition = {
  name: 'skill_list',
  description: 'List custom skills configured for this workspace.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const SKILL_GET: ToolDefinition = {
  name: 'skill_get',
  description: 'Get a custom workspace skill by id. skill_name remains as a compatibility alias.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill id',
      },
      skill_name: {
        type: 'string',
        description: 'Deprecated alias for skill name',
      },
    },
  },
};

export const SKILL_CREATE: ToolDefinition = {
  name: 'skill_create',
  description: 'Create a new custom workspace skill.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name',
      },
      description: {
        type: 'string',
        description: 'Optional skill description',
      },
      instructions: {
        type: 'string',
        description: 'Skill instructions',
      },
      triggers: {
        type: 'array',
        description: 'Optional trigger phrases',
        items: {
          type: 'string',
          description: 'Trigger phrase',
        },
      },
      metadata: SKILL_METADATA_SCHEMA,
    },
    required: ['name', 'instructions'],
  },
};

export const SKILL_UPDATE: ToolDefinition = {
  name: 'skill_update',
  description: 'Update an existing custom workspace skill by id. skill_name remains as a compatibility alias.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'Existing skill id',
      },
      skill_name: {
        type: 'string',
        description: 'Deprecated alias for existing skill name',
      },
      name: {
        type: 'string',
        description: 'Updated skill name',
      },
      description: {
        type: 'string',
        description: 'Updated description',
      },
      instructions: {
        type: 'string',
        description: 'Updated instructions',
      },
      triggers: {
        type: 'array',
        description: 'Updated trigger phrases',
        items: {
          type: 'string',
          description: 'Trigger phrase',
        },
      },
      metadata: SKILL_METADATA_SCHEMA,
      enabled: {
        type: 'boolean',
        description: 'Updated enabled flag',
      },
    },
  },
};

export const SKILL_TOGGLE: ToolDefinition = {
  name: 'skill_toggle',
  description: 'Enable or disable a custom workspace skill by id. skill_name remains as a compatibility alias.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill id',
      },
      skill_name: {
        type: 'string',
        description: 'Deprecated alias for skill name',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the skill should be enabled',
      },
    },
    required: ['enabled'],
  },
};

export const SKILL_DELETE: ToolDefinition = {
  name: 'skill_delete',
  description: 'Delete a custom workspace skill by id. skill_name remains as a compatibility alias.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill id',
      },
      skill_name: {
        type: 'string',
        description: 'Deprecated alias for skill name',
      },
    },
  },
};

export const SKILL_CONTEXT: ToolDefinition = {
  name: 'skill_context',
  description: 'List the agent-visible skill catalog, including official skills and enabled custom skills.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      locale: {
        type: 'string',
        description: 'Optional locale for localized official skill text (ja or en).',
        enum: ['ja', 'en'],
      },
    },
  },
};

export const SKILL_CATALOG: ToolDefinition = {
  name: 'skill_catalog',
  description: 'List the full agent-visible skill catalog, including official and enabled custom skills.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      locale: {
        type: 'string',
        description: 'Optional locale for localized official skill text (ja or en).',
        enum: ['ja', 'en'],
      },
    },
  },
};

export const SKILL_DESCRIBE: ToolDefinition = {
  name: 'skill_describe',
  description: 'Describe one official or custom skill in detail.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      skill_ref: {
        type: 'string',
        description: 'Skill reference. Official skills use the official skill id; custom skills should use the skill id. When source is omitted, Takos resolves official first, then custom by id, then custom by name.',
      },
      source: {
        type: 'string',
        description: 'Optional skill source hint.',
        enum: ['official', 'custom'],
      },
      skill_id: {
        type: 'string',
        description: 'Deprecated alias for official skill id.',
      },
      skill_name: {
        type: 'string',
        description: 'Deprecated alias for custom skill name.',
      },
      locale: {
        type: 'string',
        description: 'Optional locale for localized official skill text (ja or en).',
        enum: ['ja', 'en'],
      },
    },
  },
};

export const skillListHandler: ToolHandler = async (_args, context) => {
  const skills = await listSkills(context.db, context.spaceId);
  return JSON.stringify({
    skills,
    count: skills.length,
  }, null, 2);
};

export const skillGetHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || '').trim();
  const skillName = String(args.skill_name || '').trim();
  if (!skillId && !skillName) {
    throw new Error('skill_id or skill_name is required');
  }

  const skill = skillId
    ? await getSkill(context.db, context.spaceId, skillId)
    : await getSkillByName(context.db, context.spaceId, skillName);
  if (!skill) {
    throw new Error(`Skill not found: ${skillId || skillName}`);
  }

  return JSON.stringify({
    skill: formatSkill(skill),
  }, null, 2);
};

export const skillCreateHandler: ToolHandler = async (args, context) => {
  const name = String(args.name || '').trim();
  const instructions = String(args.instructions || '').trim();

  if (!name) {
    throw new Error('name is required');
  }
  if (!instructions) {
    throw new Error('instructions is required');
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

  return JSON.stringify({
    skill: skill ? formatSkill(skill) : null,
  }, null, 2);
};

export const skillUpdateHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || '').trim();
  const skillName = String(args.skill_name || '').trim();
  if (!skillId && !skillName) {
    throw new Error('skill_id or skill_name is required');
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
  const updated = skillId
    ? await updateSkill(context.db, context.spaceId, skillId, updateInput)
    : await updateSkillByName(context.db, context.spaceId, skillName, updateInput);

  if (!updated) {
    throw new Error(`Skill not found: ${skillId || skillName}`);
  }

  return JSON.stringify({
    skill: formatSkill(updated),
  }, null, 2);
};

export const skillToggleHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || '').trim();
  const skillName = String(args.skill_name || '').trim();
  if (!skillId && !skillName) {
    throw new Error('skill_id or skill_name is required');
  }

  const enabled = args.enabled === true;
  if (skillId) {
    const existing = await getSkill(context.db, context.spaceId, skillId);
    if (!existing) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    await updateSkillEnabled(context.db, skillId, enabled);
  } else {
    await updateSkillEnabledByName(context.db, context.spaceId, skillName, enabled);
  }

  return JSON.stringify({
    success: true,
    skill_id: skillId || undefined,
    skill_name: skillName || undefined,
    enabled,
  }, null, 2);
};

export const skillDeleteHandler: ToolHandler = async (args, context) => {
  const skillId = String(args.skill_id || '').trim();
  const skillName = String(args.skill_name || '').trim();
  if (!skillId && !skillName) {
    throw new Error('skill_id or skill_name is required');
  }

  if (skillId) {
    const existing = await getSkill(context.db, context.spaceId, skillId);
    if (!existing) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    await deleteSkillByName(context.db, context.spaceId, existing.name);
  } else {
    await deleteSkillByName(context.db, context.spaceId, skillName);
  }

  return JSON.stringify({
    success: true,
    skill_id: skillId || undefined,
    skill_name: skillName || undefined,
  }, null, 2);
};

export const skillContextHandler: ToolHandler = async (args, context) => {
  const locale = resolveSkillLocale({ preferredLocale: typeof args.locale === 'string' ? args.locale : undefined });
  const catalog = await listSkillContext(context.db, context.spaceId, { preferredLocale: locale });
  return JSON.stringify({
    locale: catalog.locale,
    available_skills: catalog.available_skills,
    context: catalog.available_skills,
    count: catalog.available_skills.length,
  }, null, 2);
};

export const skillCatalogHandler: ToolHandler = async (args, context) => {
  const locale = resolveSkillLocale({ preferredLocale: typeof args.locale === 'string' ? args.locale : undefined });
  const catalog = await listSkillCatalog(context.db, context.spaceId, { preferredLocale: locale });
  return JSON.stringify({
    locale: catalog.locale,
    available_skills: catalog.available_skills,
    count: catalog.available_skills.length,
  }, null, 2);
};

export const skillDescribeHandler: ToolHandler = async (args, context) => {
  const locale = resolveSkillLocale({ preferredLocale: typeof args.locale === 'string' ? args.locale : undefined });
  const skill = await describeAgentSkill(context.db, context.spaceId, {
    source: args.source === 'official' || args.source === 'custom' ? args.source : undefined,
    skillId: typeof args.skill_id === 'string' ? args.skill_id : undefined,
    skillName: typeof args.skill_name === 'string' ? args.skill_name : undefined,
    skillRef: typeof args.skill_ref === 'string' ? args.skill_ref : undefined,
    locale,
  });

  return JSON.stringify({
    skill,
  }, null, 2);
};

export const WORKSPACE_SKILL_TOOLS: ToolDefinition[] = [
  SKILL_LIST,
  SKILL_GET,
  SKILL_CREATE,
  SKILL_UPDATE,
  SKILL_TOGGLE,
  SKILL_DELETE,
  SKILL_CONTEXT,
  SKILL_CATALOG,
  SKILL_DESCRIBE,
];

export const WORKSPACE_SKILL_HANDLERS: Record<string, ToolHandler> = {
  skill_list: skillListHandler,
  skill_get: skillGetHandler,
  skill_create: skillCreateHandler,
  skill_update: skillUpdateHandler,
  skill_toggle: skillToggleHandler,
  skill_delete: skillDeleteHandler,
  skill_context: skillContextHandler,
  skill_catalog: skillCatalogHandler,
  skill_describe: skillDescribeHandler,
};
