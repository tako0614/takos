import type { Context } from "hono";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "takos-common/errors";
import type { SpaceAccessRouteEnv } from "./route-auth.ts";
import { skills as skillsTable } from "../../infra/db/schema.ts";
import { skillsRouteDeps } from "./skills-deps.ts";

export type SkillsContext = Context<SpaceAccessRouteEnv>;

export const createSkillSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  instructions: z.string().min(1, "instructions is required"),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1, "name must not be empty").optional(),
  description: z.string().optional(),
  instructions: z.string().min(1, "instructions must not be empty").optional(),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const patchSkillSchema = z.object({
  enabled: z.boolean().optional(),
});

export function getSkillIdParam(c: SkillsContext): string {
  const skillId = c.req.param("skillId");
  if (!skillId) throw new Error("skillId param is required");
  return decodeURIComponent(skillId);
}

export function getSkillNameParam(c: SkillsContext): string {
  const skillName = c.req.param("skillName");
  if (!skillName) throw new Error("skillName param is required");
  return decodeURIComponent(skillName);
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
  const skill = await skillsRouteDeps.getSkillByName(
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
  const skill = await skillsRouteDeps.getSkill(c.env.DB, space.id, skillId);
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
  const db = skillsRouteDeps.getDb(c.env.DB);
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
  if (error instanceof skillsRouteDeps.SkillMetadataValidationError) {
    throw new BadRequestError(error.message, error.details);
  }
  throw error;
}
