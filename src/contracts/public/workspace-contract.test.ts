import { expect, test } from "bun:test";

import { toWorkspaceResponse } from "../../worker/application/services/identity/response-formatters.ts";

test("the public Workspace DTO has no team, membership, owner, kind, or role fields", () => {
  const response = toWorkspaceResponse({
    id: "workspace-1",
    name: "Private",
    slug: "private",
    description: null,
    is_default: false,
    security_posture: "standard",
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
  });

  expect(response).toEqual({
    id: "workspace-1",
    name: "Private",
    slug: "private",
    description: null,
    is_default: false,
    security_posture: "standard",
    created_at: "2026-08-27T12:00:00.000Z",
    updated_at: "2026-08-27T12:00:00.000Z",
  });
  for (const legacyField of [
    "kind",
    "role",
    "member_role",
    "membership",
    "owner_principal_id",
    "automation_principal_id",
  ]) {
    expect(legacyField in response).toBe(false);
  }
});

test("the public type barrel exports no Workspace membership vocabulary", async () => {
  const publicBarrel = await Bun.file(
    `${import.meta.dir}/shared/types/index.ts`,
  ).text();
  const workspaceTypes = await Bun.file(
    `${import.meta.dir}/../../worker/shared/types/spaces.ts`,
  ).text();

  expect(`${publicBarrel}\n${workspaceTypes}`).not.toMatch(
    /\b(?:SpaceKind|SpaceRole|SpaceMembership)\b/,
  );
});
