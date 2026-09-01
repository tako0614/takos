import type { Context } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@takos/worker-platform-utils/errors";
import type { SpaceAccessRouteEnv } from "./route-auth.ts";
import { skills as skillsTable } from "../../infra/db/schema.ts";
import { getDb } from "../../infra/db/index.ts";
import {
  getSkill,
  getSkillByName,
  SkillMetadataValidationError,
} from "../../application/services/source/skills.ts";
import {
  MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
  MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
  MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
  MAX_CUSTOM_SKILL_RESOURCES,
  MAX_CUSTOM_SKILL_NAME_CHARACTERS,
  MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
  MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS,
  MAX_CUSTOM_SKILL_TRIGGERS,
} from "../../shared/types/skills.ts";

export type SkillsContext = Context<SpaceAccessRouteEnv>;

const skillListItemSchema = z.string().trim().min(1).max(
  MAX_CUSTOM_SKILL_METADATA_ITEM_CHARACTERS,
);
const skillListSchema = z.array(skillListItemSchema).max(
  MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS,
);
const skillExecutionContractSchema = z.object({
  preferred_tools: skillListSchema.optional(),
  durable_output_hints: z.array(z.enum([
    "artifact",
    "reminder",
    "repo",
    "app",
    "workspace_file",
  ])).max(MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS).optional(),
  output_modes: z.array(z.enum([
    "chat",
    "artifact",
    "reminder",
    "repo",
    "app",
    "workspace_file",
    "text",
    "structured",
  ])).max(MAX_CUSTOM_SKILL_METADATA_LIST_ITEMS).optional(),
  required_mcp_servers: skillListSchema.optional(),
  template_ids: z.array(skillListItemSchema).max(
    MAX_CUSTOM_SKILL_RESOURCES,
  ).optional(),
}).strict();
const skillMetadataSchema = z.object({
  locale: z.enum(["ja", "en"]).optional(),
  category: z.enum([
    "research",
    "writing",
    "planning",
    "slides",
    "software",
  ]).optional(),
  activation_tags: skillListSchema.optional(),
  execution_contract: skillExecutionContractSchema.optional(),
}).strict();
const skillNameSchema = z.string().trim().min(1, "name is required").max(
  MAX_CUSTOM_SKILL_NAME_CHARACTERS,
);
const skillDescriptionSchema = z.string().max(
  MAX_CUSTOM_SKILL_DESCRIPTION_CHARACTERS,
).nullable();
const skillInstructionsSchema = z.string().trim().min(
  1,
  "instructions is required",
).refine(
  (value) =>
    new TextEncoder().encode(value).byteLength <=
      MAX_CUSTOM_SKILL_INSTRUCTION_BYTES,
  `instructions must be at most ${MAX_CUSTOM_SKILL_INSTRUCTION_BYTES} bytes`,
);
const skillTriggersSchema = z.array(
  z.string().trim().min(1).max(MAX_CUSTOM_SKILL_TRIGGER_CHARACTERS),
).max(MAX_CUSTOM_SKILL_TRIGGERS);

export const createSkillSchema = z.object({
  name: skillNameSchema,
  description: skillDescriptionSchema.optional(),
  instructions: skillInstructionsSchema,
  triggers: skillTriggersSchema.optional(),
  metadata: skillMetadataSchema.nullable().optional(),
}).strict();

export const updateSkillSchema = z.object({
  name: skillNameSchema.optional(),
  description: skillDescriptionSchema.optional(),
  instructions: skillInstructionsSchema.optional(),
  triggers: skillTriggersSchema.optional(),
  metadata: skillMetadataSchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict().refine(
  (body) => Object.keys(body).length > 0,
  "At least one Skill field is required",
);

export const patchSkillSchema = z.object({
  enabled: z.boolean(),
}).strict();

export function decodeSkillReference(
  value: string | undefined,
  label: "id" | "name",
  maxCharacters: number,
): string {
  let decoded = "";
  try {
    decoded = value ? decodeURIComponent(value) : "";
  } catch {
    throw new BadRequestError(`Invalid skill ${label}`);
  }

  if (!decoded || decoded.length > maxCharacters) {
    throw new BadRequestError(`Invalid skill ${label}`);
  }
  return decoded;
}

export function getSkillIdParam(c: SkillsContext): string {
  return decodeSkillReference(
    c.req.param("skillId"),
    "id",
    MAX_CUSTOM_SKILL_REFERENCE_CHARACTERS,
  );
}

export function getSkillNameParam(c: SkillsContext): string {
  return decodeSkillReference(
    c.req.param("skillName"),
    "name",
    MAX_CUSTOM_SKILL_NAME_CHARACTERS,
  );
}

export function getSkillLocaleInput(c: SkillsContext) {
  return {
    preferredLocale: c.req.query("locale"),
    acceptLanguage: c.req.header("accept-language") ?? null,
  };
}

export async function validateJson<T extends z.ZodTypeAny>(
  c: SkillsContext,
  schema: T,
): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    throw new ValidationError("Validation error");
  }
  return result.data;
}

export async function requireSkillByName(
  c: SkillsContext,
  skillName: string,
) {
  const { space } = c.get("access");
  const skill = await getSkillByName(
    c.env.DB,
    space.id,
    skillName,
  );
  if (!skill) {
    throw new NotFoundError("Skill");
  }
  return skill;
}

export async function requireSkillById(
  c: SkillsContext,
  skillId: string,
) {
  const { space } = c.get("access");
  const skill = await getSkill(c.env.DB, space.id, skillId);
  if (!skill) {
    throw new NotFoundError("Skill");
  }
  return skill;
}

export async function assertSkillNameAvailable(
  c: SkillsContext,
  name: string,
  exceptSkillId?: string,
) {
  const { space } = c.get("access");
  const db = getDb(c.env.DB);
  const conditions = [
    eq(skillsTable.accountId, space.id),
    eq(skillsTable.name, name.trim()),
  ];
  const existing = await db.select({ id: skillsTable.id }).from(skillsTable)
    .where(
      exceptSkillId
        ? and(...conditions, ne(skillsTable.id, exceptSkillId))
        : and(...conditions),
    )
    .get();

  if (existing) {
    throw new ConflictError("Skill with this name already exists");
  }
}

export function rethrowSkillMutationError(error: unknown): never {
  if (error instanceof SkillMetadataValidationError) {
    throw new BadRequestError(error.message, error.details);
  }
  throw error;
}
