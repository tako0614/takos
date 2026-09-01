import { expect, test } from "bun:test";
import { getThreadLifecyclePermissions } from "../../lib/workspace-permissions.ts";
import type { Space, Thread } from "../../types/index.ts";

test("Thread lifecycle controls follow private Workspace presence", () => {
  expect(
    getThreadLifecyclePermissions(
      [{ id: "space-1" }] as Space[],
      { space_id: "space-1" } as Thread,
    ),
  ).toEqual({ canArchive: true, canDelete: true });

  expect(
    getThreadLifecyclePermissions(
      [{ id: "space-2" }] as Space[],
      { space_id: "space-1" } as Thread,
    ),
  ).toEqual({ canArchive: false, canDelete: false });
});
