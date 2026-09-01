import type { Space } from "../../types/index.ts";
import { MAX_SPACE_TIMESTAMP_CHARACTERS } from "takos-api-contract/shared/types";
import {
  parseWorkspaceMutationResponse,
  parseWorkspaceMutationResponseFor,
} from "../../lib/space-response.ts";

export {
  parseWorkspaceMutationResponse,
  parseWorkspaceMutationResponseFor,
} from "../../lib/space-response.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, MAX_SPACE_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`Invalid ${field}`);
  return text;
}

export function parseWorkspaceDeletionResponse(
  value: unknown,
  expected: { spaceId: string; operationId: string },
): { deletedAt: string } {
  if (!isRecord(value)) {
    throw new TypeError("Invalid Workspace deletion response");
  }
  const expectedFields = new Set([
    "success",
    "space_id",
    "operation_id",
    "deleted_at",
  ]);
  if (
    Object.keys(value).length !== expectedFields.size ||
    !Object.keys(value).every((field) => expectedFields.has(field)) ||
    value.success !== true || value.space_id !== expected.spaceId ||
    value.operation_id !== expected.operationId ||
    typeof value.operation_id !== "string" ||
    !/^[a-f0-9]{32}$/.test(value.operation_id)
  ) {
    throw new TypeError("Invalid Workspace deletion response");
  }
  return {
    deletedAt: timestamp(value.deleted_at, "Workspace deleted_at"),
  };
}

/**
 * Workspace deletion deliberately targets the immutable canonical id. A slug
 * is suitable for navigation, but cannot identify an exact retry after the
 * account row (and therefore the slug lookup) has already been removed.
 */
export function buildWorkspaceDeletionRequest(
  workspace: Pick<Space, "id" | "name">,
  operationId: string,
): {
  param: { spaceId: string };
  json: { workspace_name: string; idempotency_key: string };
} {
  return {
    param: { spaceId: workspace.id },
    json: {
      workspace_name: workspace.name,
      idempotency_key: operationId,
    },
  };
}
