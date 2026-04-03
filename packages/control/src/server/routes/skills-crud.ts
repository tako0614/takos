import type { Hono } from "hono";
import type { SpaceAccessRouteEnv } from "./route-auth.ts";
import { spaceAccess } from "./route-auth.ts";
import {
  SKILL_CREATE_ROLES,
  SKILL_DELETE_ROLES,
  SKILL_GET_ROLES,
  SKILL_LIST_ROLES,
  SKILL_TOGGLE_ROLES,
  SKILL_UPDATE_ROLES,
  skillsRouteDeps,
} from "./skills-deps.ts";
import {
  assertSkillNameAvailable,
  createSkillSchema,
  getSkillIdParam,
  getSkillNameParam,
  patchSkillSchema,
  requireSkillById,
  requireSkillByName,
  rethrowSkillMutationError,
  type SkillsContext,
  updateSkillSchema,
  validateJson,
} from "./skills-shared.ts";

type SkillsRouter = Hono<SpaceAccessRouteEnv>;

async function listSkillsHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skillsList = await skillsRouteDeps.listSkills(c.env.DB, space.id);
  return c.json({ skills: skillsList });
}

async function createSkillHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const body = await validateJson(c, createSkillSchema);
  await assertSkillNameAvailable(c, body.name);

  try {
    const skill = await skillsRouteDeps.createSkill(c.env.DB, space.id, body);
    return c.json(
      { skill: skill ? skillsRouteDeps.formatSkill(skill) : null },
      201,
    );
  } catch (error) {
    rethrowSkillMutationError(error);
  }
}

async function getSkillByNameHandler(c: SkillsContext) {
  const skill = await requireSkillByName(c, getSkillNameParam(c));
  return c.json({ skill: skillsRouteDeps.formatSkill(skill) });
}

async function getSkillByIdHandler(c: SkillsContext) {
  const skill = await requireSkillById(c, getSkillIdParam(c));
  return c.json({ skill: skillsRouteDeps.formatSkill(skill) });
}

async function updateSkillByNameHandler(c: SkillsContext) {
  const body = await validateJson(c, updateSkillSchema);
  const skillName = getSkillNameParam(c);
  const skill = await requireSkillByName(c, skillName);

  if (body.name && body.name.trim() !== skill.name) {
    await assertSkillNameAvailable(c, body.name, skill.id);
  }

  try {
    const updatedSkill = await skillsRouteDeps.updateSkillByName(
      c.env.DB,
      c.get("access").space.id,
      skillName,
      body,
    );
    return c.json({
      skill: updatedSkill ? skillsRouteDeps.formatSkill(updatedSkill) : null,
    });
  } catch (error) {
    rethrowSkillMutationError(error);
  }
}

async function updateSkillByIdHandler(c: SkillsContext) {
  const body = await validateJson(c, updateSkillSchema);
  const skillId = getSkillIdParam(c);
  const skill = await requireSkillById(c, skillId);

  if (body.name && body.name.trim() !== skill.name) {
    await assertSkillNameAvailable(c, body.name, skill.id);
  }

  try {
    const updatedSkill = await skillsRouteDeps.updateSkill(
      c.env.DB,
      c.get("access").space.id,
      skillId,
      body,
    );
    return c.json({
      skill: updatedSkill ? skillsRouteDeps.formatSkill(updatedSkill) : null,
    });
  } catch (error) {
    rethrowSkillMutationError(error);
  }
}

async function patchSkillByNameHandler(c: SkillsContext) {
  const body = await validateJson(c, patchSkillSchema);
  const skillName = getSkillNameParam(c);
  const skill = await requireSkillByName(c, skillName);
  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;

  await skillsRouteDeps.updateSkillEnabledByName(
    c.env.DB,
    c.get("access").space.id,
    skillName,
    enabled,
  );
  return c.json({ success: true, enabled });
}

async function patchSkillByIdHandler(c: SkillsContext) {
  const body = await validateJson(c, patchSkillSchema);
  const skill = await requireSkillById(c, getSkillIdParam(c));
  const enabled = body.enabled !== undefined ? body.enabled : skill.enabled;

  await skillsRouteDeps.updateSkillEnabled(c.env.DB, skill.id, enabled);
  return c.json({ success: true, enabled });
}

async function deleteSkillByNameHandler(c: SkillsContext) {
  const skillName = getSkillNameParam(c);
  await requireSkillByName(c, skillName);
  await skillsRouteDeps.deleteSkillByName(
    c.env.DB,
    c.get("access").space.id,
    skillName,
  );
  return c.json({ success: true });
}

async function deleteSkillByIdHandler(c: SkillsContext) {
  const skill = await requireSkillById(c, getSkillIdParam(c));
  await skillsRouteDeps.deleteSkillByName(
    c.env.DB,
    c.get("access").space.id,
    skill.name,
  );
  return c.json({ success: true });
}

export function registerSkillCrudRoutes(skills: SkillsRouter) {
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
    );
}
