import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { requireSpaceAccess, type BaseVariables } from './shared/route-auth';
import { zValidator } from './zod-validator';
import {
  createSkill,
  deleteSkillByName,
  formatSkill,
  getSkill,
  getOfficialSkillCatalogEntry,
  getSkillByName,
  listOfficialSkillsCatalog,
  listSkillContext,
  listSkills,
  SkillMetadataValidationError,
  updateSkill,
  updateSkillEnabled,
  updateSkillByName,
  updateSkillEnabledByName,
} from '../../application/services/source/skills';
import { getDb } from '../../infra/db';
import { skills as skillsTable } from '../../infra/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { BadRequestError, NotFoundError, ConflictError, ValidationError } from '@takos/common/errors';
import { getSpaceOperationPolicy } from '../../application/tools/tool-policy';

const skills = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

const createSkillSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  instructions: z.string().min(1, 'instructions is required'),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(1, 'name must not be empty').optional(),
  description: z.string().optional(),
  instructions: z.string().min(1, 'instructions must not be empty').optional(),
  triggers: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const patchSkillSchema = z.object({ enabled: z.boolean().optional() });
type SkillsContext = Context<{ Bindings: Env; Variables: BaseVariables }>;

const SKILL_LIST_ROLES = getSpaceOperationPolicy('skill.list').allowed_roles;
const SKILL_GET_ROLES = getSpaceOperationPolicy('skill.get').allowed_roles;
const SKILL_CREATE_ROLES = getSpaceOperationPolicy('skill.create').allowed_roles;
const SKILL_UPDATE_ROLES = getSpaceOperationPolicy('skill.update').allowed_roles;
const SKILL_TOGGLE_ROLES = getSpaceOperationPolicy('skill.toggle').allowed_roles;
const SKILL_DELETE_ROLES = getSpaceOperationPolicy('skill.delete').allowed_roles;
const SKILL_CONTEXT_ROLES = getSpaceOperationPolicy('skill.context').allowed_roles;
const SKILL_DESCRIBE_ROLES = getSpaceOperationPolicy('skill.describe').allowed_roles;

function getScopeId(c: { req: { param(name: string): string } }): string {
  return c.req.param('spaceId') || c.req.param('workspaceId');
}

function getSkillIdParam(c: SkillsContext): string {
  const skillId = c.req.param('skillId');
  if (!skillId) throw new Error('skillId param is required');
  return decodeURIComponent(skillId);
}

function getSkillNameParam(c: SkillsContext): string {
  const skillName = c.req.param('skillName');
  if (!skillName) throw new Error('skillName param is required');
  return decodeURIComponent(skillName);
}

function getSkillLocaleInput(c: SkillsContext) {
  return {
    preferredLocale: c.req.query('locale'),
    acceptLanguage: c.req.header('accept-language') ?? null,
  };
}

async function listSkillsHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_LIST_ROLES);

  const skillsList = await listSkills(c.env.DB, access.space.id);
  return c.json({ skills: skillsList });
}

async function validateJson<T extends z.ZodTypeAny>(
  c: SkillsContext,
  schema: T,
): Promise<z.infer<T>> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    throw new ValidationError('Validation error');
  }
  return result.data;
}

async function createSkillHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const body = await validateJson(c, createSkillSchema);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_CREATE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const db = getDb(c.env.DB);
  const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
    and(eq(skillsTable.accountId, access.space.id), eq(skillsTable.name, body.name.trim()))
  ).get();

  if (existing) {
    throw new ConflictError('Skill with this name already exists');
  }

  let skill;
  try {
    skill = await createSkill(c.env.DB, access.space.id, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }

  return c.json({
    skill: skill ? formatSkill(skill) : null,
  }, 201);
}

async function getSkillByNameHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillName = getSkillNameParam(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_GET_ROLES);

  const skill = await getSkillByName(c.env.DB, access.space.id, skillName);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  return c.json({
    skill: formatSkill(skill),
  });
}

async function getSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_GET_ROLES);

  const skill = await getSkill(c.env.DB, access.space.id, skillId);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  return c.json({
    skill: formatSkill(skill),
  });
}

async function updateSkillByNameHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillName = getSkillNameParam(c);
  const body = await validateJson(c, updateSkillSchema);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_UPDATE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkillByName(c.env.DB, access.space.id, skillName);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  if (body.name && body.name.trim() !== skill.name) {
    const db = getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
      and(
        eq(skillsTable.accountId, access.space.id),
        eq(skillsTable.name, body.name.trim()),
        ne(skillsTable.id, skill.id),
      )
    ).get();

    if (existing) {
      throw new ConflictError('Skill with this name already exists');
    }
  }

  let updatedSkill;
  try {
    updatedSkill = await updateSkillByName(c.env.DB, access.space.id, skillName, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }

  return c.json({
    skill: updatedSkill ? formatSkill(updatedSkill) : null,
  });
}

async function updateSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);
  const body = await validateJson(c, updateSkillSchema);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_UPDATE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkill(c.env.DB, access.space.id, skillId);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  if (body.name && body.name.trim() !== skill.name) {
    const db = getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
      and(
        eq(skillsTable.accountId, access.space.id),
        eq(skillsTable.name, body.name.trim()),
        ne(skillsTable.id, skill.id),
      )
    ).get();

    if (existing) {
      throw new ConflictError('Skill with this name already exists');
    }
  }

  let updatedSkill;
  try {
    updatedSkill = await updateSkill(c.env.DB, access.space.id, skillId, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      throw new BadRequestError(error.message, error.details);
    }
    throw error;
  }

  return c.json({
    skill: updatedSkill ? formatSkill(updatedSkill) : null,
  });
}

async function patchSkillByNameHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillName = getSkillNameParam(c);
  const body = await validateJson(c, patchSkillSchema);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_TOGGLE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkillByName(c.env.DB, access.space.id, skillName);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await updateSkillEnabledByName(c.env.DB, access.space.id, skillName, enabled);

  return c.json({ success: true, enabled });
}

async function patchSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);
  const body = await validateJson(c, patchSkillSchema);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_TOGGLE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkill(c.env.DB, access.space.id, skillId);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await updateSkillEnabled(c.env.DB, skillId, enabled);

  return c.json({ success: true, enabled });
}

async function deleteSkillByNameHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillName = getSkillNameParam(c);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_DELETE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkillByName(c.env.DB, access.space.id, skillName);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  await deleteSkillByName(c.env.DB, access.space.id, skillName);

  return c.json({ success: true });
}

async function deleteSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireSpaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_DELETE_ROLES,
    'Workspace not found or insufficient permissions'
  );

  const skill = await getSkill(c.env.DB, access.space.id, skillId);

  if (!skill) {
    throw new NotFoundError('Skill');
  }

  await deleteSkillByName(c.env.DB, access.space.id, skill.name);

  return c.json({ success: true });
}

async function skillContextHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_CONTEXT_ROLES);

  const catalog = await listSkillContext(c.env.DB, access.space.id, getSkillLocaleInput(c));
  return c.json({
    locale: catalog.locale,
    available_skills: catalog.available_skills,
    count: catalog.available_skills.length,
    context: catalog.available_skills,
  });
}

async function listOfficialSkillsHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_DESCRIBE_ROLES);

  const catalog = await listOfficialSkillsCatalog(c.env.DB, access.space.id, getSkillLocaleInput(c));
  return c.json(catalog);
}

async function getOfficialSkillHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireSpaceAccess(c, scopeId, user.id, SKILL_DESCRIBE_ROLES);

  const skill = await getOfficialSkillCatalogEntry(c.env.DB, access.space.id, skillId, getSkillLocaleInput(c));
  if (!skill) {
    throw new NotFoundError('Official skill');
  }

  return c.json({ skill });
}

skills
  .get('/spaces/:spaceId/skills', listSkillsHandler)
  .get('/workspaces/:workspaceId/skills', listSkillsHandler)
  .get('/spaces/:spaceId/official-skills', listOfficialSkillsHandler)
  .get('/workspaces/:workspaceId/official-skills', listOfficialSkillsHandler)
  .get('/spaces/:spaceId/official-skills/:skillId', getOfficialSkillHandler)
  .get('/workspaces/:workspaceId/official-skills/:skillId', getOfficialSkillHandler)
  .post('/spaces/:spaceId/skills', createSkillHandler)
  .post('/workspaces/:workspaceId/skills', createSkillHandler)
  .get('/spaces/:spaceId/skills/id/:skillId', getSkillByIdHandler)
  .get('/workspaces/:workspaceId/skills/id/:skillId', getSkillByIdHandler)
  .put('/spaces/:spaceId/skills/id/:skillId', updateSkillByIdHandler)
  .put('/workspaces/:workspaceId/skills/id/:skillId', updateSkillByIdHandler)
  .patch('/spaces/:spaceId/skills/id/:skillId', patchSkillByIdHandler)
  .patch('/workspaces/:workspaceId/skills/id/:skillId', patchSkillByIdHandler)
  .delete('/spaces/:spaceId/skills/id/:skillId', deleteSkillByIdHandler)
  .delete('/workspaces/:workspaceId/skills/id/:skillId', deleteSkillByIdHandler)
  .get('/spaces/:spaceId/skills/:skillName', getSkillByNameHandler)
  .get('/workspaces/:workspaceId/skills/:skillName', getSkillByNameHandler)
  .put('/spaces/:spaceId/skills/:skillName', updateSkillByNameHandler)
  .put('/workspaces/:workspaceId/skills/:skillName', updateSkillByNameHandler)
  .patch('/spaces/:spaceId/skills/:skillName', patchSkillByNameHandler)
  .patch('/workspaces/:workspaceId/skills/:skillName', patchSkillByNameHandler)
  .delete('/spaces/:spaceId/skills/:skillName', deleteSkillByNameHandler)
  .delete('/workspaces/:workspaceId/skills/:skillName', deleteSkillByNameHandler)
  .get('/spaces/:spaceId/skills-context', skillContextHandler)
  .get('/workspaces/:workspaceId/skills-context', skillContextHandler);

export default skills;
