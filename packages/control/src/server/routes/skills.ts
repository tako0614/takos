import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { notFound, conflict, requireWorkspaceAccess, type BaseVariables } from './shared/helpers';
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
import { badRequest, validationError } from '../../shared/utils/error-response';
import { getWorkspaceOperationPolicy } from '../../application/tools/tool-policy';

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

const SKILL_LIST_ROLES = getWorkspaceOperationPolicy('skill.list').allowed_roles;
const SKILL_GET_ROLES = getWorkspaceOperationPolicy('skill.get').allowed_roles;
const SKILL_CREATE_ROLES = getWorkspaceOperationPolicy('skill.create').allowed_roles;
const SKILL_UPDATE_ROLES = getWorkspaceOperationPolicy('skill.update').allowed_roles;
const SKILL_TOGGLE_ROLES = getWorkspaceOperationPolicy('skill.toggle').allowed_roles;
const SKILL_DELETE_ROLES = getWorkspaceOperationPolicy('skill.delete').allowed_roles;
const SKILL_CONTEXT_ROLES = getWorkspaceOperationPolicy('skill.context').allowed_roles;
const SKILL_DESCRIBE_ROLES = getWorkspaceOperationPolicy('skill.describe').allowed_roles;

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

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_LIST_ROLES);
  if (access instanceof Response) return access;

  const skillsList = await listSkills(c.env.DB, access.workspace.id);
  return c.json({ skills: skillsList });
}

async function validateJson<T extends z.ZodTypeAny>(
  c: SkillsContext,
  schema: T,
): Promise<z.infer<T> | Response> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    return validationError(c, 'Validation error', result.error.flatten());
  }
  return result.data;
}

async function createSkillHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const body = await validateJson(c, createSkillSchema);
  if (body instanceof Response) return body;

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_CREATE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const db = getDb(c.env.DB);
  const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
    and(eq(skillsTable.accountId, access.workspace.id), eq(skillsTable.name, body.name.trim()))
  ).get();

  if (existing) {
    return conflict(c, 'Skill with this name already exists');
  }

  let skill;
  try {
    skill = await createSkill(c.env.DB, access.workspace.id, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      return badRequest(c, error.message, error.details);
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

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_GET_ROLES);
  if (access instanceof Response) return access;

  const skill = await getSkillByName(c.env.DB, access.workspace.id, skillName);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  return c.json({
    skill: formatSkill(skill),
  });
}

async function getSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_GET_ROLES);
  if (access instanceof Response) return access;

  const skill = await getSkill(c.env.DB, access.workspace.id, skillId);

  if (!skill) {
    return notFound(c, 'Skill');
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
  if (body instanceof Response) return body;

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_UPDATE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkillByName(c.env.DB, access.workspace.id, skillName);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  if (body.name && body.name.trim() !== skill.name) {
    const db = getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
      and(
        eq(skillsTable.accountId, access.workspace.id),
        eq(skillsTable.name, body.name.trim()),
        ne(skillsTable.id, skill.id),
      )
    ).get();

    if (existing) {
      return conflict(c, 'Skill with this name already exists');
    }
  }

  let updatedSkill;
  try {
    updatedSkill = await updateSkillByName(c.env.DB, access.workspace.id, skillName, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      return badRequest(c, error.message, error.details);
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
  if (body instanceof Response) return body;

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_UPDATE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkill(c.env.DB, access.workspace.id, skillId);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  if (body.name && body.name.trim() !== skill.name) {
    const db = getDb(c.env.DB);
    const existing = await db.select({ id: skillsTable.id }).from(skillsTable).where(
      and(
        eq(skillsTable.accountId, access.workspace.id),
        eq(skillsTable.name, body.name.trim()),
        ne(skillsTable.id, skill.id),
      )
    ).get();

    if (existing) {
      return conflict(c, 'Skill with this name already exists');
    }
  }

  let updatedSkill;
  try {
    updatedSkill = await updateSkill(c.env.DB, access.workspace.id, skillId, body);
  } catch (error) {
    if (error instanceof SkillMetadataValidationError) {
      return badRequest(c, error.message, error.details);
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
  if (body instanceof Response) return body;

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_TOGGLE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkillByName(c.env.DB, access.workspace.id, skillName);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await updateSkillEnabledByName(c.env.DB, access.workspace.id, skillName, enabled);

  return c.json({ success: true, enabled });
}

async function patchSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);
  const body = await validateJson(c, patchSkillSchema);
  if (body instanceof Response) return body;

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_TOGGLE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkill(c.env.DB, access.workspace.id, skillId);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;
  await updateSkillEnabled(c.env.DB, skillId, enabled);

  return c.json({ success: true, enabled });
}

async function deleteSkillByNameHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillName = getSkillNameParam(c);

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_DELETE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkillByName(c.env.DB, access.workspace.id, skillName);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  await deleteSkillByName(c.env.DB, access.workspace.id, skillName);

  return c.json({ success: true });
}

async function deleteSkillByIdHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireWorkspaceAccess(
    c,
    scopeId,
    user.id,
    SKILL_DELETE_ROLES,
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const skill = await getSkill(c.env.DB, access.workspace.id, skillId);

  if (!skill) {
    return notFound(c, 'Skill');
  }

  await deleteSkillByName(c.env.DB, access.workspace.id, skill.name);

  return c.json({ success: true });
}

async function skillContextHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_CONTEXT_ROLES);
  if (access instanceof Response) return access;

  const catalog = await listSkillContext(c.env.DB, access.workspace.id, getSkillLocaleInput(c));
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

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_DESCRIBE_ROLES);
  if (access instanceof Response) return access;

  const catalog = await listOfficialSkillsCatalog(c.env.DB, access.workspace.id, getSkillLocaleInput(c));
  return c.json(catalog);
}

async function getOfficialSkillHandler(c: SkillsContext) {
  const user = c.get('user');
  const scopeId = getScopeId(c);
  const skillId = getSkillIdParam(c);

  const access = await requireWorkspaceAccess(c, scopeId, user.id, SKILL_DESCRIBE_ROLES);
  if (access instanceof Response) return access;

  const skill = await getOfficialSkillCatalogEntry(c.env.DB, access.workspace.id, skillId, getSkillLocaleInput(c));
  if (!skill) {
    return notFound(c, 'Official skill');
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
