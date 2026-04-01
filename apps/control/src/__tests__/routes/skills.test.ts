import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { NotFoundError } from "takos-common/errors";
import { routeAuthDeps } from "@/routes/route-auth";
import { skillsRouteDeps } from "@/routes/skills";

const mocks = {
  createSkill: ((..._args: any[]) => undefined) as any,
  deleteSkillByName: ((..._args: any[]) => undefined) as any,
  formatSkill: (s: any) => s,
  getSkill: ((..._args: any[]) => undefined) as any,
  getOfficialSkillCatalogEntry: ((..._args: any[]) => undefined) as any,
  getSkillByName: ((..._args: any[]) => undefined) as any,
  listOfficialSkillsCatalog: ((..._args: any[]) => undefined) as any,
  listSkillContext: ((..._args: any[]) => undefined) as any,
  listSkills: ((..._args: any[]) => undefined) as any,
  SkillMetadataValidationError: class extends Error {
    details: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.details = details;
    }
  },
  updateSkill: ((..._args: any[]) => undefined) as any,
  updateSkillEnabled: ((..._args: any[]) => undefined) as any,
  updateSkillByName: ((..._args: any[]) => undefined) as any,
  updateSkillEnabledByName: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  getSpaceOperationPolicy: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/source/skills'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/tools/tool-policy'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/db/schema'
import skillsRoute from "@/routes/skills";

function createUser(): User {
  return {
    id: "user-1",
    email: "user1@example.com",
    name: "User One",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  Object.assign(routeAuthDeps, {
    requireSpaceAccess: async (...args: any[]) => {
      const value = await mocks.requireSpaceAccess(...args);
      if (!value) {
        throw new NotFoundError("Space");
      }
      if (value instanceof Response) {
        throw new NotFoundError("Space");
      }
      if ("workspace" in value && !("space" in value)) {
        return {
          space: value.workspace,
          membership: value.membership ?? { role: "owner" },
        };
      }
      return value;
    },
  });
  Object.assign(skillsRouteDeps, {
    createSkill: (...args: any[]) => mocks.createSkill(...args),
    deleteSkillByName: (...args: any[]) => mocks.deleteSkillByName(...args),
    formatSkill: (skill: any) => mocks.formatSkill(skill),
    getDb: (...args: any[]) => mocks.getDb(...args),
    getSkill: (...args: any[]) => mocks.getSkill(...args),
    getOfficialSkillCatalogEntry: (...args: any[]) =>
      mocks.getOfficialSkillCatalogEntry(...args),
    getSkillByName: (...args: any[]) => mocks.getSkillByName(...args),
    listOfficialSkillsCatalog: (...args: any[]) =>
      mocks.listOfficialSkillsCatalog(...args),
    listSkillContext: (...args: any[]) => mocks.listSkillContext(...args),
    listSkills: (...args: any[]) => mocks.listSkills(...args),
    updateSkill: (...args: any[]) => mocks.updateSkill(...args),
    updateSkillEnabled: (...args: any[]) => mocks.updateSkillEnabled(...args),
    updateSkillByName: (...args: any[]) => mocks.updateSkillByName(...args),
    updateSkillEnabledByName: (...args: any[]) =>
      mocks.updateSkillEnabledByName(...args),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", skillsRoute);
  return app;
}

const env = createMockEnv();

Deno.test("skills routes - GET /api/spaces/:spaceId/skills - returns skills list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const skillsList = [{ id: "sk-1", name: "test-skill" }];
  mocks.listSkills = (async () => skillsList) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { skills: skillsList });
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.requireSpaceAccess =
    (async () =>
      new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404,
      })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-bad/skills"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - POST /api/spaces/:spaceId/skills - creates a skill and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined, // no existing skill
  };
  mocks.getDb = (() => dbChain) as any;
  mocks.createSkill =
    (async () => ({ id: "sk-new", name: "new-skill" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new-skill",
        instructions: "Do something",
      }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - rejects skill with missing name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: "Do something",
      }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - rejects skill with missing instructions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-skill",
      }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - returns 409 when skill name already exists", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => ({ id: "sk-existing" }),
  };
  mocks.getDb = (() => dbChain) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "existing-skill",
        instructions: "Do something",
      }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 409);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills/:skillName - returns skill by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "test-skill" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing-skill"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/:skillName - deletes a skill", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "old-skill" })) as any;
  mocks.deleteSkillByName = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});
Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills-context - returns skill context catalog", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.listSkillContext = (async () => ({
    locale: "en",
    available_skills: [{ name: "test-skill" }],
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills-context"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("locale" in json);
  assert("available_skills" in json);
  assert("count" in json);
  assertEquals((json as any)["count"], 1);
});

Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - updates a skill by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined,
  };
  mocks.getDb = (() => dbChain) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "old-skill" })) as any;
  mocks.updateSkillByName = (async () => ({
    id: "sk-1",
    name: "updated-skill",
    instructions: "Updated",
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated-skill", instructions: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - returns 409 when renaming to an existing name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "old-skill" })) as any;
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => ({ id: "sk-other" }),
  };
  mocks.getDb = (() => dbChain) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "taken-name" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 409);
});

Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - toggles skill enabled by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "test-skill", enabled: true })) as any;
  mocks.updateSkillEnabledByName = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: false });
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - keeps current enabled state when body omits enabled", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkillByName =
    (async () => ({ id: "sk-1", name: "test-skill", enabled: true })) as any;
  mocks.updateSkillEnabledByName = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: true });
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills/id/:skillId - returns skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => ({ id: "sk-1", name: "test-skill" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/id/:skillId - updates a skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => ({ id: "sk-1", name: "old-skill" })) as any;
  mocks.updateSkill =
    (async () => ({ id: "sk-1", name: "updated-skill" })) as any;
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined,
  };
  mocks.getDb = (() => dbChain) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated-skill" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/id/:skillId - toggles skill enabled by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill =
    (async () => ({ id: "sk-1", name: "test-skill", enabled: false })) as any;
  mocks.updateSkillEnabled = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: true });
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/id/:skillId - deletes a skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => ({ id: "sk-1", name: "old-skill" })) as any;
  mocks.deleteSkillByName = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});
Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.getSkill = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/official-skills - returns official skills catalog", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess =
    (async () => ({ workspace: { id: "ws-1" } })) as any;
  mocks.listOfficialSkillsCatalog = (async () => ({
    skills: [{ id: "os-1", name: "Official Skill" }],
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/official-skills"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
