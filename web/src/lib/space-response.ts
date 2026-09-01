import {
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_ID_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
  MAX_SPACE_SLUG_CHARACTERS,
  MAX_SPACE_TIMESTAMP_CHARACTERS,
  MAX_SPACES_PER_RESPONSE,
} from "takos-api-contract/shared/types";
import type { Space } from "../types/index.ts";

const SECURITY_POSTURES = new Set(["standard", "restricted_egress"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maxCharacters ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

function nullableString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string | null {
  return value === null
    ? null
    : boundedString(value, field, maxCharacters, true);
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, MAX_SPACE_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid ${field}`);
  }
  return text;
}

export function parseSpaceRecord(value: unknown): Space {
  const candidate = record(value);
  if (
    !candidate || typeof candidate.is_default !== "boolean" ||
    !SECURITY_POSTURES.has(candidate.security_posture as string) ||
    candidate.member_role !== undefined || candidate.kind !== undefined ||
    candidate.owner_principal_id !== undefined ||
    candidate.automation_principal_id !== undefined
  ) {
    throw new TypeError("Invalid Workspace response record");
  }

  const space: Space = {
    id: boundedString(
      candidate.id,
      "Workspace id",
      MAX_SPACE_ID_CHARACTERS,
    ),
    slug: boundedString(
      candidate.slug,
      "Workspace slug",
      MAX_SPACE_SLUG_CHARACTERS,
    ),
    name: boundedString(
      candidate.name,
      "Workspace name",
      MAX_SPACE_NAME_CHARACTERS,
    ),
    description: nullableString(
      candidate.description,
      "Workspace description",
      MAX_SPACE_DESCRIPTION_CHARACTERS,
    ),
    is_default: candidate.is_default,
    security_posture: candidate.security_posture as Space["security_posture"],
    created_at: timestamp(candidate.created_at, "Workspace created_at"),
    updated_at: timestamp(candidate.updated_at, "Workspace updated_at"),
  };

  return space;
}

export function parseSpacesResponse(value: unknown): Space[] {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.spaces) ||
    candidate.spaces.length === 0 ||
    candidate.spaces.length > MAX_SPACES_PER_RESPONSE
  ) {
    throw new TypeError("Invalid Workspace inventory response");
  }

  const spaces = candidate.spaces.map(parseSpaceRecord);
  const ids = new Set<string>();
  const routeIdentifiers = new Set<string>();
  let personalSpaces = 0;

  for (const space of spaces) {
    const routeIdentifier = space.is_default ? "me" : space.slug!;
    if (ids.has(space.id) || routeIdentifiers.has(routeIdentifier)) {
      throw new TypeError("Duplicate Workspace identity");
    }
    ids.add(space.id);
    routeIdentifiers.add(routeIdentifier);
    if (space.is_default) personalSpaces += 1;
  }

  if (personalSpaces !== 1) {
    throw new TypeError("Invalid personal Workspace inventory");
  }
  return spaces;
}

export type WorkspaceMutationExpectation = {
  id?: string;
  isDefault?: boolean;
  name?: string;
  description?: string | null;
  securityPosture?: Space["security_posture"];
};

export function parseWorkspaceMutationResponseFor(
  value: unknown,
  expected: WorkspaceMutationExpectation,
): Space {
  const candidate = record(value);
  if (!candidate || !record(candidate.space)) {
    throw new TypeError("Invalid Workspace response");
  }
  const space = parseSpaceRecord(candidate.space);
  if (
    (expected.id !== undefined && space.id !== expected.id) ||
    (expected.isDefault !== undefined &&
      space.is_default !== expected.isDefault) ||
    (expected.name !== undefined && space.name !== expected.name) ||
    (expected.description !== undefined &&
      space.description !== expected.description) ||
    (expected.securityPosture !== undefined &&
      space.security_posture !== expected.securityPosture)
  ) {
    throw new TypeError("Workspace response does not match the request");
  }
  return space;
}

export function parseWorkspaceMutationResponse(value: unknown): Space {
  return parseWorkspaceMutationResponseFor(value, {});
}
