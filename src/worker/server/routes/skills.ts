import { Hono } from "hono";
import type { SpaceAccessRouteEnv } from "./route-auth.ts";
import { registerSkillCatalogRoutes } from "./skills-catalog.ts";
import { registerSkillCrudRoutes } from "./skills-crud.ts";

const skills = new Hono<SpaceAccessRouteEnv>();

registerSkillCrudRoutes(skills);
registerSkillCatalogRoutes(skills);

export { skillsRouteDeps } from "./skills-deps.ts";
export default skills;
