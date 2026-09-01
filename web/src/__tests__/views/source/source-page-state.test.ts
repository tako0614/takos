import { expect, test } from "bun:test";
import { resolveSourceSpaceId } from "../../../views/source/source-page-state.ts";

test("Store target selection keeps an authorized requested Workspace", () => {
  const spaces = [
    { id: "workspace-1", slug: "me-db", is_default: true },
    { id: "workspace-2", slug: "project-2", is_default: false },
  ] as never;
  expect(resolveSourceSpaceId(spaces, "project-2")).toBe("project-2");
  expect(resolveSourceSpaceId(spaces, "workspace-foreign")).toBe(
    "me",
  );
  expect(resolveSourceSpaceId([], "project-2")).toBeNull();
});
