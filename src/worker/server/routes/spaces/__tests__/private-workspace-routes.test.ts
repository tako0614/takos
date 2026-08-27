import { expect, test } from "bun:test";
import { Hono } from "hono";

import type { Env } from "../../../../shared/types/index.ts";
import spaces from "../routes.ts";

test("the Workspace router does not mount member or invitation routes", async () => {
  const source = await Bun.file(`${import.meta.dir}/../index.ts`).text();
  const apiSource = await Bun.file(`${import.meta.dir}/../../api.ts`).text();

  expect(source).not.toContain('from "./members.ts"');
  expect(apiSource).not.toContain('from "./spaces/members.ts"');
  expect(source).not.toMatch(/\.route\([^\n]*members/i);
  expect(source).not.toMatch(/\.route\([^\n]*invites?/i);
  expect(apiSource).toContain('.route("/spaces", spacesBase)');
  expect(await Bun.file(`${import.meta.dir}/../members.ts`).exists()).toBe(false);
});

test("the removed /members transport returns 404", async () => {
  const app = new Hono<{
    Bindings: Env;
    Variables: { user: { id: string } };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "principal-a" });
    await next();
  });
  app.route("/api/spaces", spaces);

  const response = await app.request(
    "/api/spaces/workspace-1/members",
    undefined,
    { DB: {} } as Env,
  );
  expect(response.status).toBe(404);
});

test("every app-local Workspace route uses the owner-only access gate", async () => {
  const routeRoot = `${import.meta.dir}/../..`;
  const sources: string[] = [];
  const glob = new Bun.Glob("**/*.ts");
  for await (const path of glob.scan({ cwd: routeRoot, absolute: true })) {
    if (path.includes("/__tests__/") || path.endsWith("_test.ts")) continue;
    sources.push(await Bun.file(path).text());
  }
  const source = sources.join("\n");

  expect(source).not.toMatch(/spaceAccess\(\{\s*roles\s*:/);
  expect(source).not.toMatch(
    /(?:requireSpaceAccess|checkSpaceAccess|checkThreadAccess|checkRunAccess)\([\s\S]{0,180}?\[\s*["']owner["']/,
  );
  expect(source).not.toContain("access.membership.role");
});

test("the bundled SPA has no Workspace member, invite, or role controls", async () => {
  const cards = await Bun.file(
    `${import.meta.dir}/../../../../../../web/src/views/hub/SpaceSettingsCards.tsx`,
  ).text();
  const section = await Bun.file(
    `${import.meta.dir}/../../../../../../web/src/views/hub/SpaceSettingsSection.tsx`,
  ).text();

  expect(`${cards}\n${section}`).not.toMatch(
    /MembersCard|SpaceMember|inviteRole|inviteMember|\/members/,
  );
});
