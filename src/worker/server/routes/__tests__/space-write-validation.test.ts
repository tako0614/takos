import { expect, test } from "bun:test";
import {
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
} from "../../../shared/types/index.ts";
import {
  workspaceCreateSchema,
  workspaceDeleteSchema,
  workspacePatchSchema,
} from "../spaces/routes.ts";

test("Workspace writes are strict, bounded, and normalized", () => {
  const idempotencyKey = "ab".repeat(16);
  expect(workspaceCreateSchema.parse({
    name: "  Product Team  ",
    description: "  Shared product work  ",
    installFeaturedApps: true,
    idempotency_key: idempotencyKey,
  })).toEqual({
    name: "Product Team",
    description: "Shared product work",
    installFeaturedApps: true,
    idempotency_key: idempotencyKey,
  });
  expect(workspacePatchSchema.parse({
    name: "  Renamed  ",
    description: "  Focused work  ",
  })).toEqual({
    name: "Renamed",
    description: "Focused work",
  });
  expect(workspacePatchSchema.parse({ description: null })).toEqual({
    description: null,
  });
  expect(workspaceDeleteSchema.parse({
    workspace_name: "  Product Team  ",
    idempotency_key: idempotencyKey,
  })).toEqual({
    workspace_name: "Product Team",
    idempotency_key: idempotencyKey,
  });

  expect(workspaceCreateSchema.safeParse({
    name: "Team",
    idempotency_key: idempotencyKey,
    forged: true,
  }).success).toBe(false);
  expect(workspaceCreateSchema.safeParse({ name: " " }).success).toBe(false);
  expect(workspaceCreateSchema.safeParse({
    name: "x".repeat(MAX_SPACE_NAME_CHARACTERS + 1),
    idempotency_key: idempotencyKey,
  }).success).toBe(false);
  expect(workspaceCreateSchema.safeParse({
    name: "Team",
    description: "x".repeat(MAX_SPACE_DESCRIPTION_CHARACTERS + 1),
    idempotency_key: idempotencyKey,
  }).success).toBe(false);
  expect(workspaceCreateSchema.safeParse({
    name: "Team",
    idempotency_key: idempotencyKey,
    id: "not an opaque id",
  }).success).toBe(false);
  expect(workspaceCreateSchema.safeParse({
    name: "Team",
    idempotency_key: "predictable",
  }).success).toBe(false);
  expect(workspacePatchSchema.safeParse({ name: " " }).success).toBe(false);
  expect(workspacePatchSchema.safeParse({
    description: "x".repeat(MAX_SPACE_DESCRIPTION_CHARACTERS + 1),
  }).success).toBe(false);
  expect(workspacePatchSchema.safeParse({ unknown: "value" }).success).toBe(
    false,
  );
  expect(workspaceDeleteSchema.safeParse({
    workspace_name: "Product Team",
  }).success).toBe(false);
  expect(workspaceDeleteSchema.safeParse({
    workspace_name: "Product Team",
    idempotency_key: idempotencyKey,
    force: true,
  }).success).toBe(false);
});
