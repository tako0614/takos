import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import { routeAuthDeps } from "@/routes/route-auth";
import { skillsRouteDeps } from "@/routes/skills";
import { asyncNoopDep, noopDep } from "@test/dep-stubs";

type LooseAsyncFn = (...args: never[]) => Promise<unknown>;
type LooseFn = (...args: never[]) => unknown;

const mocks: {
  createSkill: LooseAsyncFn;
  deleteSkillByName: LooseAsyncFn;
  formatSkill: (s: unknown) => unknown;
  getSkill: LooseAsyncFn;
  getManagedSkillCatalogEntry: LooseAsyncFn;
  getSkillByName: LooseAsyncFn;
  listManagedSkillsCatalog: LooseAsyncFn;
  listSkillContext: LooseAsyncFn;
  listSkills: LooseAsyncFn;
  SkillMetadataValidationError: new (
    message: string,
    details?: unknown,
  ) => Error;
  updateSkill: LooseAsyncFn;
  updateSkillEnabled: LooseAsyncFn;
  updateSkillByName: LooseAsyncFn;
  updateSkillEnabledByName: LooseAsyncFn;
  requireSpaceAccess: LooseAsyncFn;
  getDb: LooseFn;
  getSpaceOperationPolicy: LooseFn;
} = {
  createSkill: asyncNoopDep("skillsRouteDeps.createSkill"),
  deleteSkillByName: asyncNoopDep("skillsRouteDeps.deleteSkillByName"),
  formatSkill: (s) => s,
  getSkill: asyncNoopDep("skillsRouteDeps.getSkill"),
  getManagedSkillCatalogEntry: asyncNoopDep(
    "skillsRouteDeps.getManagedSkillCatalogEntry",
  ),
  getSkillByName: asyncNoopDep("skillsRouteDeps.getSkillByName"),
  listManagedSkillsCatalog: asyncNoopDep(
    "skillsRouteDeps.listManagedSkillsCatalog",
  ),
  listSkillContext: asyncNoopDep("skillsRouteDeps.listSkillContext"),
  listSkills: asyncNoopDep("skillsRouteDeps.listSkills"),
  SkillMetadataValidationError: class extends Error {
    details: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.details = details;
    }
  },
  updateSkill: asyncNoopDep("skillsRouteDeps.updateSkill"),
  updateSkillEnabled: asyncNoopDep("skillsRouteDeps.updateSkillEnabled"),
  updateSkillByName: asyncNoopDep("skillsRouteDeps.updateSkillByName"),
  updateSkillEnabledByName: asyncNoopDep(
    "skillsRouteDeps.updateSkillEnabledByName",
  ),
  requireSpaceAccess: asyncNoopDep("routeAuthDeps.requireSpaceAccess"),
  getDb: noopDep("skillsRouteDeps.getDb"),
  getSpaceOperationPolicy: noopDep("skillsRouteDeps.getSpaceOperationPolicy"),
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
    requireSpaceAccess: (async (...args: unknown[]) => {
      const value = await (mocks
        .requireSpaceAccess as ((...a: unknown[]) => Promise<unknown>))(
          ...args,
        );
      if (!value) {
        throw new NotFoundError("Space");
      }
      if (value instanceof Response) {
        throw new NotFoundError("Space");
      }
      const candidate = value as {
        workspace?: { id: string };
        space?: { id: string };
        membership?: { role: string };
      };
      if (candidate.workspace && !candidate.space) {
        return {
          space: candidate.workspace,
          membership: candidate.membership ?? { role: "owner" },
        };
      }
      return value;
    }) as typeof routeAuthDeps.requireSpaceAccess,
  });
  function callMock<K extends keyof typeof mocks>(
    key: K,
    args: unknown[],
  ): unknown {
    const fn = mocks[key] as (...a: unknown[]) => unknown;
    return fn(...args);
  }
  Object.assign(skillsRouteDeps, {
    createSkill: ((...args: unknown[]) =>
      callMock("createSkill", args)) as typeof skillsRouteDeps.createSkill,
    deleteSkillByName: ((...args: unknown[]) =>
      callMock(
        "deleteSkillByName",
        args,
      )) as typeof skillsRouteDeps.deleteSkillByName,
    formatSkill: ((...args: unknown[]) =>
      callMock("formatSkill", args)) as typeof skillsRouteDeps.formatSkill,
    getDb: ((...args: unknown[]) =>
      callMock("getDb", args)) as typeof skillsRouteDeps.getDb,
    getSkill: ((...args: unknown[]) =>
      callMock("getSkill", args)) as typeof skillsRouteDeps.getSkill,
    getManagedSkillCatalogEntry: ((...args: unknown[]) =>
      callMock(
        "getManagedSkillCatalogEntry",
        args,
      )) as typeof skillsRouteDeps.getManagedSkillCatalogEntry,
    getSkillByName: ((...args: unknown[]) =>
      callMock(
        "getSkillByName",
        args,
      )) as typeof skillsRouteDeps.getSkillByName,
    listManagedSkillsCatalog: ((...args: unknown[]) =>
      callMock(
        "listManagedSkillsCatalog",
        args,
      )) as typeof skillsRouteDeps.listManagedSkillsCatalog,
    listSkillContext: ((...args: unknown[]) =>
      callMock(
        "listSkillContext",
        args,
      )) as typeof skillsRouteDeps.listSkillContext,
    listSkills: ((...args: unknown[]) =>
      callMock("listSkills", args)) as typeof skillsRouteDeps.listSkills,
    updateSkill: ((...args: unknown[]) =>
      callMock("updateSkill", args)) as typeof skillsRouteDeps.updateSkill,
    updateSkillEnabled: ((...args: unknown[]) =>
      callMock(
        "updateSkillEnabled",
        args,
      )) as typeof skillsRouteDeps.updateSkillEnabled,
    updateSkillByName: ((...args: unknown[]) =>
      callMock(
        "updateSkillByName",
        args,
      )) as typeof skillsRouteDeps.updateSkillByName,
    updateSkillEnabledByName: ((...args: unknown[]) =>
      callMock(
        "updateSkillEnabledByName",
        args,
      )) as typeof skillsRouteDeps.updateSkillEnabledByName,
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", skillsRoute);
  return app;
}

const env = createMockEnv();

Deno.test("skills routes - route map does not include workspace aliases", () => {
  const signatures = skillsRoute.routes.map((
    route: { method: string; path: string },
  ) => `${route.method} ${route.path}`);

  assertEquals(
    signatures.some((signature) => signature.includes("/workspaces/")),
    false,
  );
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills - returns skills list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const skillsList = [{ id: "sk-1", name: "test-skill" }];
  mocks.listSkills = async () => skillsList;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { skills: skillsList });
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.requireSpaceAccess = async () =>
    new Response(JSON.stringify({ error: "Workspace not found" }), {
      status: 404,
    });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-bad/skills"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - POST /api/spaces/:spaceId/skills - creates a skill and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined, // no existing skill
  };
  mocks.getDb = () => dbChain;
  mocks.createSkill = async () => ({ id: "sk-new", name: "new-skill" });

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
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - rejects skill with missing name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instructions: "Do something",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - rejects skill with missing instructions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-skill",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("skills routes - POST /api/spaces/:spaceId/skills - returns 409 when skill name already exists", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => ({ id: "sk-existing" }),
  };
  mocks.getDb = () => dbChain;

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
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 409);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills/:skillName - returns skill by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => ({ id: "sk-1", name: "test-skill" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing-skill"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/:skillName - deletes a skill", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => ({ id: "sk-1", name: "old-skill" });
  mocks.deleteSkillByName = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "DELETE",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});
Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "DELETE",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills-context - returns skill context catalog", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.listSkillContext = async () => ({
    locale: "en",
    available_skills: [{ name: "test-skill" }],
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills-context"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("locale" in json);
  assert("available_skills" in json);
  assert("count" in json);
  assertEquals(json["count"], 1);
});

Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - updates a skill by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined,
  };
  mocks.getDb = () => dbChain;
  mocks.getSkillByName = async () => ({ id: "sk-1", name: "old-skill" });
  mocks.updateSkillByName = async () => ({
    id: "sk-1",
    name: "updated-skill",
    instructions: "Updated",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated-skill", instructions: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/:skillName - returns 409 when renaming to an existing name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => ({ id: "sk-1", name: "old-skill" });
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => ({ id: "sk-other" }),
  };
  mocks.getDb = () => dbChain;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/old-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "taken-name" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 409);
});

Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - toggles skill enabled by name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => ({
    id: "sk-1",
    name: "test-skill",
    enabled: true,
  });
  mocks.updateSkillEnabledByName = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: false });
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - returns 404 when skill not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/:skillName - keeps current enabled state when body omits enabled", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkillByName = async () => ({
    id: "sk-1",
    name: "test-skill",
    enabled: true,
  });
  mocks.updateSkillEnabledByName = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/test-skill", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: true });
});

Deno.test("skills routes - GET /api/spaces/:spaceId/skills/id/:skillId - returns skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => ({ id: "sk-1", name: "test-skill" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - GET /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/id/:skillId - updates a skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => ({ id: "sk-1", name: "old-skill" });
  mocks.updateSkill = async () => ({ id: "sk-1", name: "updated-skill" });
  const dbChain: any = {
    select: () => dbChain,
    from: () => dbChain,
    where: () => dbChain,
    get: async () => undefined,
  };
  mocks.getDb = () => dbChain;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "updated-skill" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("skill" in json);
});
Deno.test("skills routes - PUT /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/id/:skillId - toggles skill enabled by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => ({
    id: "sk-1",
    name: "test-skill",
    enabled: false,
  });
  mocks.updateSkillEnabled = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assertEquals(json, { success: true, enabled: true });
});
Deno.test("skills routes - PATCH /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/id/:skillId - deletes a skill by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => ({ id: "sk-1", name: "old-skill" });
  mocks.deleteSkillByName = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-1", {
      method: "DELETE",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});
Deno.test("skills routes - DELETE /api/spaces/:spaceId/skills/id/:skillId - returns 404 when skill id not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.getSkill = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/skills/id/sk-missing", {
      method: "DELETE",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("skills routes - GET /api/spaces/:spaceId/managed-skills - returns managed skills catalog", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ workspace: { id: "ws-1" } });
  mocks.listManagedSkillsCatalog = async () => ({
    skills: [{ id: "os-1", name: "Managed Skill" }],
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/managed-skills"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
