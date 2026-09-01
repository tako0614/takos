import { expect, test } from "bun:test";
import {
  buildWorkspaceDeletionRequest,
  parseWorkspaceDeletionResponse,
  parseWorkspaceMutationResponse,
  parseWorkspaceMutationResponseFor,
} from "../../../views/hub/workspace-response.ts";

test("Workspace deletion targets canonical id rather than mutable slug", () => {
  expect(buildWorkspaceDeletionRequest({
    id: "space-category",
    name: "Personal project",
  }, "ab".repeat(16))).toEqual({
    param: { spaceId: "space-category" },
    json: {
      workspace_name: "Personal project",
      idempotency_key: "ab".repeat(16),
    },
  });
});

test("Workspace response validators reject malformed successful bodies", () => {
  expect(parseWorkspaceMutationResponse({
    space: {
      id: "space-category",
      slug: "personal-project",
      name: "Personal project",
      description: null,
      is_default: false,
      security_posture: "standard",
      created_at: "2026-08-10T10:00:00.000Z",
      updated_at: "2026-08-10T10:00:00.000Z",
    },
  }).slug).toBe("personal-project");
  expect(() => parseWorkspaceMutationResponse({ space: {} })).toThrow(
    TypeError,
  );
  expect(() =>
    parseWorkspaceMutationResponseFor({
      space: {
        id: "space-category",
        slug: "personal-project",
        name: "Personal project",
        description: null,
        is_default: false,
        security_posture: "standard",
        created_at: "2026-08-10T10:00:00.000Z",
        updated_at: "2026-08-10T10:00:00.000Z",
      },
    }, { securityPosture: "restricted_egress" })
  ).toThrow(TypeError);
  expect(parseWorkspaceDeletionResponse({
    success: true,
    space_id: "space-category",
    operation_id: "ab".repeat(16),
    deleted_at: "2026-08-10T12:00:00.000Z",
  }, {
    spaceId: "space-category",
    operationId: "ab".repeat(16),
  })).toEqual({ deletedAt: "2026-08-10T12:00:00.000Z" });
  expect(() =>
    parseWorkspaceDeletionResponse({
      success: true,
      space_id: "space-category",
      operation_id: "cd".repeat(16),
      deleted_at: "2026-08-10T12:00:00.000Z",
    }, {
      spaceId: "space-category",
      operationId: "ab".repeat(16),
    })
  ).toThrow(TypeError);
});
