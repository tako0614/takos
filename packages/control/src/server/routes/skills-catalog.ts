import type { Hono } from "hono";
import type { SpaceAccessRouteEnv } from "./route-auth.ts";
import { spaceAccess } from "./route-auth.ts";
import {
  SKILL_CONTEXT_ROLES,
  SKILL_DESCRIBE_ROLES,
  skillsRouteDeps,
} from "./skills-deps.ts";
import {
  getSkillIdParam,
  getSkillLocaleInput,
  type SkillsContext,
} from "./skills-shared.ts";
import { NotFoundError } from "takos-common/errors";

type SkillsRouter = Hono<SpaceAccessRouteEnv>;

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

async function listManagedSkillsHandler(c: SkillsContext) {
  const { space } = c.get("access");
  return c.json(
    await skillsRouteDeps.listManagedSkillsCatalog(
      c.env.DB,
      space.id,
      getSkillLocaleInput(c),
    ),
  );
}

async function getManagedSkillHandler(c: SkillsContext) {
  const { space } = c.get("access");
  const skill = await skillsRouteDeps.getManagedSkillCatalogEntry(
    c.env.DB,
    space.id,
    getSkillIdParam(c),
    getSkillLocaleInput(c),
  );
  if (!skill) {
    throw new NotFoundError("Managed skill");
  }
  return c.json({ skill });
}

export function registerSkillCatalogRoutes(skills: SkillsRouter) {
  skills
    .get(
      "/spaces/:spaceId/managed-skills",
      spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
      listManagedSkillsHandler,
    )
    .get(
      "/spaces/:spaceId/managed-skills/:skillId",
      spaceAccess({ roles: SKILL_DESCRIBE_ROLES }),
      getManagedSkillHandler,
    )
    .get(
      "/spaces/:spaceId/skills-context",
      spaceAccess({ roles: SKILL_CONTEXT_ROLES }),
      skillContextHandler,
    );
}
