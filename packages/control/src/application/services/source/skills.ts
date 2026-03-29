import type { D1Database } from '../../../shared/types/bindings.ts';
import { and, desc, eq } from 'drizzle-orm';

import { getDb, skills as skillsTable } from '../../../infra/db';
import { generateId } from '../../../shared/utils';
import {
  getOfficialSkillById,
  listLocalizedOfficialSkills,
  normalizeCustomSkillMetadata,
  resolveSkillLocale,
  validateCustomSkillMetadata,
} from '../agent/official-skills';
import { applySkillAvailability, type SkillCatalogEntry, type SkillContext } from '../agent/skills';
import type { CustomSkillMetadata, SkillLocale } from '../agent/skill-contracts';
import { hasSkillTemplate, listSkillTemplates } from '../agent/skill-templates';
import { listMcpServers } from '../platform/mcp';
import { logWarn } from '../../../shared/utils/logger';

export class SkillMetadataValidationError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, string>,
  ) {
    super(message);
    this.name = 'SkillMetadataValidationError';
  }
}

export interface SkillRow {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  instructions: string;
  triggers: string | null;
  metadata: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function parseTriggers(triggers: string | null) {
  return triggers ? triggers.split(',').map((t) => t.trim()).filter(Boolean) : [];
}

export function parseSkillMetadata(metadata: string | null | undefined): CustomSkillMetadata {
  if (!metadata?.trim()) {
    return {};
  }

  try {
    return normalizeCustomSkillMetadata(JSON.parse(metadata));
  } catch (error) {
    logWarn('Failed to parse custom skill metadata', { module: 'services/source/skills', error: error instanceof Error ? error.message : String(error) });
    return {};
  }
}

function serializeSkillMetadata(metadata?: unknown): string {
  return JSON.stringify(normalizeCustomSkillMetadata(metadata));
}

export function formatSkill(skill: SkillRow) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    triggers: parseTriggers(skill.triggers),
    metadata: parseSkillMetadata(skill.metadata),
    source: 'custom' as const,
    editable: true,
    enabled: skill.enabled,
    created_at: skill.created_at,
    updated_at: skill.updated_at,
  };
}

function toCustomSkillContext(skill: SkillRow): SkillContext {
  const metadata = parseSkillMetadata(skill.metadata);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? '',
    instructions: skill.instructions,
    triggers: parseTriggers(skill.triggers),
    source: 'custom',
    category: metadata.category ?? 'custom',
    locale: metadata.locale,
    version: undefined,
    activation_tags: [...(metadata.activation_tags ?? [])],
    execution_contract: {
      preferred_tools: [...(metadata.execution_contract?.preferred_tools ?? [])],
      durable_output_hints: [...(metadata.execution_contract?.durable_output_hints ?? [])],
      output_modes: [...(metadata.execution_contract?.output_modes ?? ['chat'])],
      required_mcp_servers: [...(metadata.execution_contract?.required_mcp_servers ?? [])],
      template_ids: [...(metadata.execution_contract?.template_ids ?? [])],
    },
    availability: 'available',
    availability_reasons: [],
    metadata,
  };
}

function toSkillRow(s: {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  instructions: string;
  triggers: string | null;
  metadata: string | null;
  enabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}): SkillRow {
  return {
    id: s.id,
    space_id: s.accountId,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    triggers: s.triggers,
    metadata: s.metadata || '{}',
    enabled: s.enabled,
    created_at: (s.createdAt == null ? null : typeof s.createdAt === 'string' ? s.createdAt : s.createdAt.toISOString()),
    updated_at: (s.updatedAt == null ? null : typeof s.updatedAt === 'string' ? s.updatedAt : s.updatedAt.toISOString()),
  };
}

export async function listSkills(db: D1Database, spaceId: string) {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.accountId, spaceId))
    .orderBy(desc(skillsTable.updatedAt), desc(skillsTable.createdAt))
    .all();

  return rows.map((skill) => formatSkill(toSkillRow(skill)));
}

export async function getSkill(db: D1Database, spaceId: string, skillId: string): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const skill = await drizzle
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.id, skillId), eq(skillsTable.accountId, spaceId)))
    .get();

  if (!skill) return null;
  return toSkillRow(skill);
}

export async function getSkillByName(db: D1Database, spaceId: string, name: string): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const skill = await drizzle
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.accountId, spaceId), eq(skillsTable.name, name)))
    .get();

  if (!skill) return null;
  return toSkillRow(skill);
}

export async function createSkill(
  db: D1Database,
  spaceId: string,
  input: {
    name: string;
    description?: string;
    instructions: string;
    triggers?: string[];
    metadata?: unknown;
  },
): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const metadata = await validateSkillMetadataForWorkspace(db, spaceId, input.metadata);
  const skillId = generateId();
  const timestamp = new Date().toISOString();
  const triggersStr = input.triggers?.join(',') || null;

  const skill = await drizzle
    .insert(skillsTable)
    .values({
      id: skillId,
      accountId: spaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      instructions: input.instructions.trim(),
      triggers: triggersStr,
      metadata: serializeSkillMetadata(metadata),
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning()
    .get();

  return toSkillRow(skill);
}

export async function updateSkill(
  db: D1Database,
  spaceId: string,
  skillId: string,
  input: {
    name?: string;
    description?: string;
    instructions?: string;
    triggers?: string[];
    metadata?: unknown;
    enabled?: boolean;
  },
): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const skill = await getSkill(db, spaceId, skillId);
  if (!skill) return null;
  const metadata = input.metadata !== undefined
    ? await validateSkillMetadataForWorkspace(db, spaceId, input.metadata)
    : parseSkillMetadata(skill.metadata);

  const timestamp = new Date().toISOString();
  const name = input.name?.trim() || skill.name;
  const description = input.description !== undefined ? (input.description?.trim() || null) : skill.description;
  const instructions = input.instructions?.trim() || skill.instructions;
  const triggersStr = input.triggers !== undefined ? (input.triggers.join(',') || null) : skill.triggers;
  const enabled = input.enabled !== undefined ? input.enabled : skill.enabled;
  const metadataJson = serializeSkillMetadata(metadata);

  const updated = await drizzle
    .update(skillsTable)
    .set({
      name,
      description,
      instructions,
      triggers: triggersStr,
      metadata: metadataJson,
      enabled,
      updatedAt: timestamp,
    })
    .where(eq(skillsTable.id, skillId))
    .returning()
    .get();

  return toSkillRow(updated);
}

export async function updateSkillByName(
  db: D1Database,
  spaceId: string,
  skillName: string,
  input: {
    name?: string;
    description?: string;
    instructions?: string;
    triggers?: string[];
    metadata?: unknown;
    enabled?: boolean;
  },
): Promise<SkillRow | null> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) return null;

  return updateSkill(db, spaceId, skill.id, input);
}

export async function updateSkillEnabled(db: D1Database, skillId: string, enabled: boolean): Promise<boolean> {
  const drizzle = getDb(db);
  const timestamp = new Date().toISOString();

  await drizzle
    .update(skillsTable)
    .set({
      enabled,
      updatedAt: timestamp,
    })
    .where(eq(skillsTable.id, skillId));

  return enabled;
}

export async function updateSkillEnabledByName(db: D1Database, spaceId: string, skillName: string, enabled: boolean): Promise<boolean> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error('Skill not found');

  return updateSkillEnabled(db, skill.id, enabled);
}

export async function deleteSkill(db: D1Database, skillId: string): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(skillsTable).where(eq(skillsTable.id, skillId));
}

export async function deleteSkillByName(db: D1Database, spaceId: string, skillName: string): Promise<void> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error('Skill not found');

  return deleteSkill(db, skill.id);
}

export async function listEnabledCustomSkillContext(db: D1Database, spaceId: string): Promise<SkillContext[]> {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.accountId, spaceId), eq(skillsTable.enabled, true)))
    .orderBy(desc(skillsTable.updatedAt), desc(skillsTable.createdAt))
    .all();

  return rows.map((skill) => toCustomSkillContext(toSkillRow(skill)));
}

function localizeCustomSkillCatalog(skill: SkillContext): SkillCatalogEntry {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: [...skill.triggers],
    source: skill.source,
    category: skill.category,
    locale: skill.locale,
    version: skill.version,
    activation_tags: [...(skill.activation_tags ?? [])],
    execution_contract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [...skill.execution_contract.durable_output_hints],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: skill.availability,
    availability_reasons: [...skill.availability_reasons],
  };
}

export async function listSkillCatalog(
  db: D1Database,
  spaceId: string,
  localeInput?: { preferredLocale?: string | null; acceptLanguage?: string | null; textSamples?: string[] },
): Promise<{ locale: SkillLocale; available_skills: SkillCatalogEntry[] }> {
  const customSkills = await listEnabledCustomSkillContext(db, spaceId);
  const locale = resolveSkillLocale(localeInput);
  const enabledMcpServers = (await listMcpServers(db, spaceId))
    .filter((server) => server.enabled)
    .map((server) => server.name);
  const templateIds = listSkillTemplates().map((template) => template.id);
  const officialSkills = applySkillAvailability(
    listLocalizedOfficialSkills(locale).map((skill) => ({
      ...skill,
      source: 'official' as const,
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available' as const,
      availability_reasons: [],
    })),
    {
      availableMcpServerNames: enabledMcpServers,
      availableTemplateIds: templateIds,
    },
  );
  const customSkillsWithAvailability = applySkillAvailability(customSkills, {
    availableMcpServerNames: enabledMcpServers,
    availableTemplateIds: templateIds,
  });

  return {
    locale,
    available_skills: [
      ...officialSkills,
      ...customSkillsWithAvailability.map((skill) => localizeCustomSkillCatalog(skill)),
    ],
  };
}

export async function listSkillContext(
  db: D1Database,
  spaceId: string,
  localeInput?: { preferredLocale?: string | null; acceptLanguage?: string | null; textSamples?: string[] },
) {
  return listSkillCatalog(db, spaceId, localeInput);
}

export async function listOfficialSkillsCatalog(
  db: D1Database,
  spaceId: string,
  localeInput?: { preferredLocale?: string | null; acceptLanguage?: string | null; textSamples?: string[] },
) {
  const locale = resolveSkillLocale(localeInput);
  const enabledMcpServers = (await listMcpServers(db, spaceId))
    .filter((server) => server.enabled)
    .map((server) => server.name);
  const templateIds = listSkillTemplates().map((template) => template.id);
  const officialSkills = applySkillAvailability(
    listLocalizedOfficialSkills(locale).map((skill) => ({
      ...skill,
      source: 'official' as const,
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: 'available' as const,
      availability_reasons: [],
    })),
    {
      availableMcpServerNames: enabledMcpServers,
      availableTemplateIds: templateIds,
    },
  );
  return {
    locale,
    skills: officialSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      triggers: [...skill.triggers],
      source: 'official' as const,
      editable: false,
      category: skill.category,
      enabled: true,
      locale,
      version: skill.version,
      activation_tags: [...(skill.activation_tags ?? [])],
      execution_contract: {
        preferred_tools: [...skill.execution_contract.preferred_tools],
        durable_output_hints: [...skill.execution_contract.durable_output_hints],
        output_modes: [...skill.execution_contract.output_modes],
        required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
        template_ids: [...skill.execution_contract.template_ids],
      },
      availability: skill.availability,
      availability_reasons: [...skill.availability_reasons],
    })),
  };
}

export async function getOfficialSkillCatalogEntry(
  db: D1Database,
  spaceId: string,
  skillId: string,
  localeInput?: { preferredLocale?: string | null; acceptLanguage?: string | null; textSamples?: string[] },
) {
  const locale = resolveSkillLocale(localeInput);
  const skill = getOfficialSkillById(skillId, locale);
  if (!skill) {
    return null;
  }
  const enabledMcpServers = (await listMcpServers(db, spaceId))
    .filter((server) => server.enabled)
    .map((server) => server.name);
  const templateIds = listSkillTemplates().map((template) => template.id);
  const [withAvailability] = applySkillAvailability([{
    ...skill,
    source: 'official' as const,
    execution_contract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [...skill.execution_contract.durable_output_hints],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [...skill.execution_contract.required_mcp_servers],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: 'available' as const,
    availability_reasons: [],
  }], {
    availableMcpServerNames: enabledMcpServers,
    availableTemplateIds: templateIds,
  });

  return {
    id: withAvailability.id,
    name: withAvailability.name,
    description: withAvailability.description,
    instructions: withAvailability.instructions,
    triggers: [...withAvailability.triggers],
    source: 'official' as const,
    editable: false,
    category: withAvailability.category,
    enabled: true,
    locale,
    version: withAvailability.version,
    activation_tags: [...(withAvailability.activation_tags ?? [])],
    execution_contract: {
      preferred_tools: [...withAvailability.execution_contract.preferred_tools],
      durable_output_hints: [...withAvailability.execution_contract.durable_output_hints],
      output_modes: [...withAvailability.execution_contract.output_modes],
      required_mcp_servers: [...withAvailability.execution_contract.required_mcp_servers],
      template_ids: [...withAvailability.execution_contract.template_ids],
    },
    availability: withAvailability.availability,
    availability_reasons: [...withAvailability.availability_reasons],
  };
}

export async function describeAgentSkill(
  db: D1Database,
  spaceId: string,
  input: {
    source?: 'official' | 'custom';
    skillId?: string;
    skillName?: string;
    skillRef?: string;
    locale?: string;
    acceptLanguage?: string | null;
  },
) {
  const ref = input.skillRef?.trim() || input.skillId?.trim() || input.skillName?.trim() || '';
  if (!ref) {
    throw new Error('skill_ref, skill_id, or skill_name is required');
  }

  const localeInput = {
    preferredLocale: input.locale,
    acceptLanguage: input.acceptLanguage,
  };

  if (input.source === 'official') {
    const officialSkill = await getOfficialSkillCatalogEntry(db, spaceId, ref, localeInput);
    if (!officialSkill) {
      throw new Error(`Official skill not found: ${ref}`);
    }
    return officialSkill;
  }

  if (input.source === 'custom') {
    const customSkill = input.skillId
      ? await getSkill(db, spaceId, input.skillId)
      : await getSkillByName(db, spaceId, ref);
    if (!customSkill) {
      throw new Error(`Skill not found: ${ref}`);
    }
    return formatSkill(customSkill);
  }

  const officialSkill = await getOfficialSkillCatalogEntry(db, spaceId, ref, localeInput);
  if (officialSkill) {
    return officialSkill;
  }

  const customSkill = await getSkill(db, spaceId, ref) ?? await getSkillByName(db, spaceId, ref);
  if (customSkill) {
    return formatSkill(customSkill);
  }

  throw new Error(`Skill not found: ${ref}`);
}

async function validateSkillMetadataForWorkspace(
  db: D1Database,
  spaceId: string,
  metadataInput: unknown,
): Promise<CustomSkillMetadata> {
  const { normalized, fieldErrors } = validateCustomSkillMetadata(metadataInput);
  const details = { ...fieldErrors };

  const invalidTemplateIds = (normalized.execution_contract?.template_ids ?? []).filter((templateId) => !hasSkillTemplate(templateId));
  if (invalidTemplateIds.length > 0) {
    details['execution_contract.template_ids'] = `unknown template ids: ${invalidTemplateIds.join(', ')}`;
  }

  const knownMcpServerNames = new Set(
    (await listMcpServers(db, spaceId))
      .filter((server) => server.enabled)
      .map((server) => server.name),
  );
  const unknownMcpServers = (normalized.execution_contract?.required_mcp_servers ?? []).filter((name) => !knownMcpServerNames.has(name));
  if (unknownMcpServers.length > 0) {
    details['execution_contract.required_mcp_servers'] = `unknown MCP servers: ${unknownMcpServers.join(', ')}`;
  }

  if (Object.keys(details).length > 0) {
    throw new SkillMetadataValidationError('Invalid skill metadata', details);
  }

  return normalized;
}
