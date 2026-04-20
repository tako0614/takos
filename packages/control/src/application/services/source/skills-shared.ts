import type { D1Database } from "../../../shared/types/bindings.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import {
  getManagedSkillById,
  listLocalizedManagedSkills,
  type LocalizedManagedSkill,
  normalizeCustomSkillMetadata,
  resolveSkillLocale,
  validateCustomSkillMetadata,
} from "../agent/managed-skills.ts";
import {
  applySkillAvailability,
  cloneExecutionContract,
  type SkillCatalogEntry,
  type SkillContext,
  toSkillCatalogEntry,
} from "../agent/skills.ts";
import type {
  CustomSkillMetadata,
  SkillLocale,
} from "../agent/skill-contracts.ts";
import {
  hasSkillTemplate,
  listSkillTemplates,
} from "../agent/skill-templates.ts";
import { listMcpServers } from "../platform/mcp.ts";

export class SkillMetadataValidationError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, string>,
  ) {
    super(message);
    this.name = "SkillMetadataValidationError";
  }
}

export interface SkillRow {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  instructions: string;
  triggers: string | null;
  metadata: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SkillMutationInput = {
  name?: string;
  description?: string;
  instructions?: string;
  triggers?: string[];
  metadata?: unknown;
  enabled?: boolean;
};

export type SkillLocaleInput = {
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
  textSamples?: string[];
};

export type SkillAvailabilityDetails = {
  availableMcpServerNames: string[];
  availableTemplateIds: string[];
};

export function parseTriggers(triggers: string | null) {
  return triggers
    ? triggers.split(",").map((trigger) => trigger.trim()).filter(Boolean)
    : [];
}

export function parseSkillMetadata(
  metadata: string | null | undefined,
): CustomSkillMetadata {
  if (!metadata?.trim()) {
    return {};
  }

  try {
    return normalizeCustomSkillMetadata(JSON.parse(metadata));
  } catch (error) {
    logWarn("Failed to parse custom skill metadata", {
      module: "services/source/skills",
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

export function serializeSkillMetadata(metadata?: unknown): string {
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
    source: "custom" as const,
    editable: true,
    enabled: skill.enabled,
    created_at: skill.createdAt,
    updated_at: skill.updatedAt,
  };
}

export function toCustomSkillContext(skill: SkillRow): SkillContext {
  const metadata = parseSkillMetadata(skill.metadata);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? "",
    instructions: skill.instructions,
    triggers: parseTriggers(skill.triggers),
    source: "custom",
    category: metadata.category ?? "custom",
    locale: metadata.locale,
    version: undefined,
    activation_tags: [...(metadata.activation_tags ?? [])],
    execution_contract: {
      preferred_tools: [
        ...(metadata.execution_contract?.preferred_tools ?? []),
      ],
      durable_output_hints: [
        ...(metadata.execution_contract?.durable_output_hints ?? []),
      ],
      output_modes: [
        ...(metadata.execution_contract?.output_modes ?? ["chat"]),
      ],
      required_mcp_servers: [
        ...(metadata.execution_contract?.required_mcp_servers ?? []),
      ],
      template_ids: [...(metadata.execution_contract?.template_ids ?? [])],
    },
    availability: "available",
    availability_reasons: [],
    metadata,
  };
}

export function toAvailableManagedSkill(
  skill: LocalizedManagedSkill,
): SkillContext {
  return {
    ...skill,
    triggers: [...skill.triggers],
    activation_tags: [...skill.activation_tags],
    source: "managed",
    execution_contract: cloneExecutionContract(skill.execution_contract),
    availability: "available",
    availability_reasons: [],
  };
}

export function toSkillRow(s: {
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
    spaceId: s.accountId,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
    triggers: s.triggers,
    metadata: s.metadata || "{}",
    enabled: s.enabled,
    createdAt: textDate(s.createdAt),
    updatedAt: textDate(s.updatedAt),
  };
}

export async function getSkillAvailabilityDetails(
  db: D1Database,
  spaceId: string,
): Promise<SkillAvailabilityDetails> {
  const templateIds = listSkillTemplates().map((template) => template.id);
  const enabledMcpServers = await listMcpServers(db, spaceId);

  return {
    availableMcpServerNames: enabledMcpServers
      .filter((server) => server.enabled)
      .map((server) => server.name),
    availableTemplateIds: templateIds,
  };
}

export async function listAvailableManagedSkillContexts(
  db: D1Database,
  spaceId: string,
  locale: SkillLocale,
  availability?: SkillAvailabilityDetails,
): Promise<SkillContext[]> {
  const details = availability ??
    await getSkillAvailabilityDetails(db, spaceId);
  return applySkillAvailability(
    listLocalizedManagedSkills(locale).map(toAvailableManagedSkill),
    details,
  );
}

export async function validateSkillMetadataForWorkspace(
  db: D1Database,
  spaceId: string,
  metadataInput: unknown,
): Promise<CustomSkillMetadata> {
  const { normalized, fieldErrors } = validateCustomSkillMetadata(
    metadataInput,
  );
  const details = { ...fieldErrors };

  const invalidTemplateIds = (normalized.execution_contract?.template_ids ?? [])
    .filter((templateId) => !hasSkillTemplate(templateId));
  if (invalidTemplateIds.length > 0) {
    details["execution_contract.template_ids"] = `unknown template ids: ${
      invalidTemplateIds.join(", ")
    }`;
  }

  const knownMcpServerNames = new Set(
    (await listMcpServers(db, spaceId))
      .filter((server) => server.enabled)
      .map((server) => server.name),
  );
  const unknownMcpServers =
    (normalized.execution_contract?.required_mcp_servers ?? []).filter((name) =>
      !knownMcpServerNames.has(name)
    );
  if (unknownMcpServers.length > 0) {
    details["execution_contract.required_mcp_servers"] =
      `unknown MCP servers: ${unknownMcpServers.join(", ")}`;
  }

  if (Object.keys(details).length > 0) {
    throw new SkillMetadataValidationError("Invalid skill metadata", details);
  }

  return normalized;
}

export {
  applySkillAvailability,
  getManagedSkillById,
  listLocalizedManagedSkills,
  resolveSkillLocale,
  toSkillCatalogEntry,
};
export type {
  CustomSkillMetadata,
  SkillCatalogEntry,
  SkillContext,
  SkillLocale,
};
