import { type Context, Hono } from "hono";
import { z } from "zod";
import { spaceAccess, type SpaceAccessRouteEnv } from "./route-auth.ts";
import {
  createSkill,
  deleteSkillByName,
  formatSkill,
  getOfficialSkillCatalogEntry,
  getSkill,
  getSkillByName,
  listOfficialSkillsCatalog,
  listSkillContext,
  listSkills,
  SkillMetadataValidationError,
  updateSkill,
  updateSkillByName,
  updateSkillEnabled,
  updateSkillEnabledByName,
} from "../../application/services/source/skills.ts";
import { getDb } from "../../infra/db/index.ts";
import { skills as skillsTable } from "../../infra/db/schema.ts";
import { and, eq, ne } from "drizzle-orm";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "takos-common/errors";
import { getSpaceOperationPolicy } from "../../application/tools/tool-policy.ts";

const skills = new Hono<SpaceAccessRouteEnv>();

const createSkillSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  instructions: z.string().min(1, "instructions is required"),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(1, "name must not be empty").optional(),
  description: z.string().optional(),
  instructions: z.string().min(1, "instructions must not be empty").optional(),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const patchSkillSchema = z.object({ enabled: z.boolean().optional() });
type SkillsContext = Context<SpaceAccessRouteEnv>;

const SKILL_LIST_ROLES = getSpaceOperationPolicy("skill.list").allowed_roles;
const SKILL_GET_ROLES = getSpaceOperationPolicy("skill.get").allowed_roles;
const SKILL_CREATE_ROLES =
  getSpaceOperationPolicy("skill.create").allowed_roles;
const SKILL_UPDATE_ROLES =
  getSpaceOperationPolicy("skill.update").allowed_roles;
const SKILL_TOGGLE_ROLES =
  getSpaceOperationPolicy("skill.toggle").allowed_roles;
const SKILL_DELETE_ROLES =
  getSpaceOperationPolicy("skill.delete").allowed_roles;
const SKILL_CONTEXT_ROLES =
  getSpaceOperationPolicy("skill.context").allowed_roles;
const SKILL_DESCRIBE_ROLES =
  getSpaceOperationPolicy("skill.describe").allowed_roles;

export const skillsRouteDeps = {
  createSkill,
  deleteSkillByName,
  formatSkill,
  getDb,
  getSkill,
  getOfficialSkillCatalogEntry,
  getSkillByName,
  listOfficialSkillsCatalog,
  listSkillContext,
  listSkills,
  updateSkill,
  updateSkillEnabled,
  updateSkillByName,
  updateSkillEnabledByName,
};

function getSkillIdParam(c: SkillsContext): string {
  const skillId = c.req.param("skillId");
  if (!skillId) throw new Error("skillId param is required");
  return decodeURIComponent(skillId);
}

function getSkillNameParam(c: SkillsContext): string {
  const skillName = c.req.param("skillName");
  if (!skillName) throw new Error("skillName param is required");
  return decodeURIComponent(skillName);
}

function getSkillLocaleInput(c: SkillsContext) {
  return {
    preferredLocale: c.req.query("locale"),
    acceptLanguage: c.req.header("accept-language") ?? null,
  };
}

async function validateJson<T extends z.ZodTypeAny>(
  c: SkillsContext,
  schema: T,
): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) throw new ValidationError("Validation error");
  return result.data;
}

async function listSkillsHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillsList = await skillsRouteDeps.listSkills(c.env.DB, space.id);
  return c.json({ skills: skillsList });
}

async function createSkillHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const body = await validateJson(c, createSkillSchema);
  const db = skillsRouteDeps.getDb(c.env.DB);
  const existing = await db.select({ id: skillsTable.id }).from(skillsTable)
    .where(
      and(
        eq(skillsTable.accountId, space.id),
        eq(skillsTable.name, body.name.trim()),
      ),
    ).get();
  if (existing) throw new ConflictError("Skill with this name already exists");
  let skill;
  try {
    skill = await skillsRouteDeps.createSkill(c.env.DB, space.id, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }
  return c.json(
    { skill: skill ? skillsRouteDeps.formatSkill(skill) : null },
    201,
  );
}

async function getSkillByNameHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillName = getSkillNameParam(c);
  const skill = await skillsRouteDeps.getSkillByName(
    c.env.DB,
    space.id,
    skillName,
  );
  if (!skill) throw new NotFoundError("Skill");
  return c.json({ skill: skillsRouteDeps.formatSkill(skill) });
}

async function getSkillByIdHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillId = getSkillIdParam(c);
  const skill = await skillsRouteDeps.getSkill(c.env.DB, space.id, skillId);
  if (!skill) throw new NotFoundError("Skill");
  return c.json({ skill: skillsRouteDeps.formatSkill(skill) });
}

async function updateSkillByNameHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillName = getSkillNameParam(c);
  const body = await validateJson(c, updateSkillSchema);
  const skill = await skillsRouteDeps.getSkillByName(
    c.env.DB,
    space.id,
    skillName,
  );
  if (!skill) throw new NotFoundError("Skill");
  if (body.name && body.name.trim() !== skill.name) {
    const db = skillsRouteDeps.getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable)
      .where(
        and(
          eq(skillsTable.accountId, space.id),
          eq(skillsTable.name, body.name.trim()),
          ne(skillsTable.id, skill.id),
        ),
      ).get();
    if (existing) {
      throw new ConflictError("Skill with this name already exists");
    }
  }
  let updatedSkill;
  try {
    updatedSkill = await skillsRouteDeps.updateSkillByName(
      c.env.DB,
      space.id,
      skillName,
      body,
    );
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }
  return c.json({
    skill: updatedSkill ? skillsRouteDeps.formatSkill(updatedSkill) : null,
  });
}

async function updateSkillByIdHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillId = getSkillIdParam(c);
  const body = await validateJson(c, updateSkillSchema);
  const skill = await skillsRouteDeps.getSkill(c.env.DB, space.id, skillId);
  if (!skill) throw new NotFoundError("Skill");
  if (body.name && body.name.trim() !== skill.name) {
    const db = skillsRouteDeps.getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable)
      .where(
        and(
          eq(skillsTable.accountId, space.id),
          eq(skillsTable.name, body.name.trim()),
          ne(skillsTable.id, skill.id),
        ),
      ).get();
    if (existing) {
      throw new ConflictError("Skill with this name already exists");
    }
  }
  let updatedSkill;
  try {
    updatedSkill = await skillsRouteDeps.updateSkill(
      c.env.DB,
      space.id,
      skillId,
      body,
    );
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }
  return c.json({
    skill: updatedSkill ? skillsRouteDeps.formatSkill(updatedSkill) : null,
  });
}

async function patchSkillByNameHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillName = getSkillNameParam(c);
  const body = await validateJson(c, patchSkillSchema);
  const skill = await skillsRouteDeps.getSkillByName(
    c.env.DB,
    space.id,
    skillName,
  );
  if (!skill) throw new NotFoundError("Skill");
  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await skillsRouteDeps.updateSkillEnabledByName(
    c.env.DB,
    space.id,
    skillName,
    enabled,
  );
  return c.json({ success: true, enabled });
}

async function patchSkillByIdHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillId = getSkillIdParam(c);
  const body = await validateJson(c, patchSkillSchema);
  const skill = await skillsRouteDeps.getSkill(c.env.DB, space.id, skillId);
  if (!skill) throw new NotFoundError("Skill");
  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await skillsRouteDeps.updateSkillEnabled(c.env.DB, skillId, enabled);
  return c.json({ success: true, enabled });
}

async function deleteSkillByNameHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillName = getSkillNameParam(c);
  const skill = await skillsRouteDeps.getSkillByName(
    c.env.DB,
    space.id,
    skillName,
  );
  if (!skill) throw new NotFoundError("Skill");
  await skillsRouteDeps.deleteSkillByName(c.env.DB, space.id, skillName);
  return c.json({ success: true });
}

async function deleteSkillByIdHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillId = getSkillIdParam(c);
  const skill = await skillsRouteDeps.getSkill(c.env.DB, space.id, skillId);
  if (!skill) throw new NotFoundError("Skill");
  await skillsRouteDeps.deleteSkillByName(c.env.DB, space.id, skill.name);
  return c.json({ success: true });
}

async function skillContextHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const catalog = await skillsRouteDeps.listSkillContext(
    c.env.DB,
    space.id,
    getSkillLocaleInput(c),
  );
  return c.json({
    locale: catalog.locale,
    available_skills: catalog.available_skills,
    count: catalog.available_skills.length,
    context: catalog.available_skills,
  });
}

async function listOfficialSkillsHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const catalog = await skillsRouteDeps.listOfficialSkillsCatalog(
    c.env.DB,
    space.id,
    getSkillLocaleInput(c),
  );
  return c.json(catalog);
}

async function getOfficialSkillHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillId = getSkillIdParam(c);
  const skill = await skillsRouteDeps.getOfficialSkillCatalogEntry(
    c.env.DB,
    space.id,
    skillId,
    getSkillLocaleInput(c),
  );
  if (!skill) throw new NotFoundError("Official skill");
  return c.json({ skill });
}

skills
  .get(
    "/spaces/:spaceId/skills",
    spaceAccess({ roles: SKILL_LIST_ROLES }),
    listSkillsHandler,
  )
  .get(
    "/workspaces/:workspaceId/skills",
    spaceAccess({ roles: SKILL_LIST_ROLES }),
    listSkillsHandler,
  )
  .get(
    "/spaces/:spaceId/official-skills",
    spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
    listOfficialSkillsHandler,
  )
  .get(
    "/workspaces/:workspaceId/official-skills",
    spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
    listOfficialSkillsHandler,
  )
  .get(
    "/spaces/:spaceId/official-skills/:skillId",
    spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
    getOfficialSkillHandler,
  )
  .get(
    "/workspaces/:workspaceId/official-skills/:skillId",
    spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
    getOfficialSkillHandler,
  )
  .post(
    "/spaces/:spaceId/skills",
    spaceAccess({
      roles: SKILL_CREATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    createSkillHandler,
  )
  .post(
    "/workspaces/:workspaceId/skills",
    spaceAccess({
      roles: SKILL_CREATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    createSkillHandler,
  )
  .get(
    "/spaces/:spaceId/skills/id/:skillId",
    spaceAccess({ roles: SKILL_GET_ROLES }),
    getSkillByIdHandler,
  )
  .get(
    "/workspaces/:workspaceId/skills/id/:skillId",
    spaceAccess({ roles: SKILL_GET_ROLES }),
    getSkillByIdHandler,
  )
  .put(
    "/spaces/:spaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_UPDATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    updateSkillByIdHandler,
  )
  .put(
    "/workspaces/:workspaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_UPDATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    updateSkillByIdHandler,
  )
  .patch(
    "/spaces/:spaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_TOGGLE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    patchSkillByIdHandler,
  )
  .patch(
    "/workspaces/:workspaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_TOGGLE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    patchSkillByIdHandler,
  )
  .delete(
    "/spaces/:spaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_DELETE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    deleteSkillByIdHandler,
  )
  .delete(
    "/workspaces/:workspaceId/skills/id/:skillId",
    spaceAccess({
      roles: SKILL_DELETE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    deleteSkillByIdHandler,
  )
  .get(
    "/spaces/:spaceId/skills/:skillName",
    spaceAccess({ roles: SKILL_GET_ROLES }),
    getSkillByNameHandler,
  )
  .get(
    "/workspaces/:workspaceId/skills/:skillName",
    spaceAccess({ roles: SKILL_GET_ROLES }),
    getSkillByNameHandler,
  )
  .put(
    "/spaces/:spaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_UPDATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    updateSkillByNameHandler,
  )
  .put(
    "/workspaces/:workspaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_UPDATE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    updateSkillByNameHandler,
  )
  .patch(
    "/spaces/:spaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_TOGGLE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    patchSkillByNameHandler,
  )
  .patch(
    "/workspaces/:workspaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_TOGGLE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    patchSkillByNameHandler,
  )
  .delete(
    "/spaces/:spaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_DELETE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    deleteSkillByNameHandler,
  )
  .delete(
    "/workspaces/:workspaceId/skills/:skillName",
    spaceAccess({
      roles: SKILL_DELETE_ROLES,
      message: "Workspace not found or insufficient permissions",
    }),
    deleteSkillByNameHandler,
  )
  .get(
    "/spaces/:spaceId/skills-context",
    spaceAccess({ roles: SKILL_CONTEXT_ROLES }),
    skillContextHandler,
  )
  .get(
    "/workspaces/:workspaceId/skills-context",
    spaceAccess({ roles: SKILL_CONTEXT_ROLES }),
    skillContextHandler,
  );

export default skills;
