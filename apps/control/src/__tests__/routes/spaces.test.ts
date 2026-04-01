import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assert, assertEquals } from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import spacesRoutes from "@/routes/spaces/routes";
import { spacesRouteDeps } from "@/routes/spaces/routes";

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
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/spaces", spacesRoutes);
  return app;
}

Deno.test("spaces route surface - returns spaces key on /api/spaces", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  spacesRouteDeps.listWorkspacesForUser = (async () => [{
    id: "ws-1",
    kind: "user",
    name: "Personal",
    slug: "personal",
    owner_principal_id: "user-1",
    security_posture: "standard",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    member_role: "owner",
    repository: {
      id: "repo-1",
      name: "main",
      default_branch: "main",
    },
  }]) as any;
  const response = await createApp(createUser()).fetch(
    new Request("http://localhost/api/spaces"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), {
    spaces: [{
      id: "ws-1",
      slug: "personal",
      name: "Personal",
      description: null,
      kind: "user",
      owner_principal_id: "user-1",
      automation_principal_id: null,
      security_posture: "standard",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    }],
  });
});
Deno.test("spaces route surface - does not expose a legacy workspaces key", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  spacesRouteDeps.listWorkspacesForUser = (async () => [{
    id: "ws-1",
    kind: "user",
    name: "Personal",
    slug: "personal",
    owner_principal_id: "user-1",
    security_posture: "standard",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    member_role: "owner",
    repository: {
      id: "repo-1",
      name: "main",
      default_branch: "main",
    },
  }]) as any;
  const response = await createApp(createUser()).fetch(
    new Request("http://localhost/api/spaces"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assert("spaces" in payload);
  assert(!("workspaces" in payload));
});
