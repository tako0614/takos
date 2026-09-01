import { describe, expect, test } from "bun:test";
import {
  MAX_SPACE_NAME_CHARACTERS,
} from "takos-api-contract/shared/types";
import {
  parseSpacesResponse,
  parseWorkspaceMutationResponse,
  parseWorkspaceMutationResponseFor,
} from "../../lib/space-response.ts";

const now = "2026-08-10T10:00:00.000Z";

function space(overrides: Record<string, unknown> = {}) {
  return {
    id: "space-1",
    slug: "project-one",
    name: "Project One",
    description: null,
    is_default: false,
    security_posture: "standard",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function personalSpace(overrides: Record<string, unknown> = {}) {
  return space({
    id: "space-personal",
    slug: "personal-slug",
    name: "Personal",
    is_default: true,
    ...overrides,
  });
}

describe("Workspace inventory response parsing", () => {
  test("accepts one default Workspace plus private category Workspaces", () => {
    const result = parseSpacesResponse({
      spaces: [personalSpace(), space()],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "space-personal",
      is_default: true,
    });
    expect(result[1]).toMatchObject({
      id: "space-1",
      is_default: false,
    });
  });

  test("rejects malformed authority, identity, timestamps, and field budgets", () => {
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), space({ member_role: "owner" })],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), space({ id: undefined })],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), space({ created_at: "not-a-date" })],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseSpacesResponse({
        spaces: [
          personalSpace(),
          space({ name: "x".repeat(MAX_SPACE_NAME_CHARACTERS + 1) }),
        ],
      })
    ).toThrow(TypeError);
  });

  test("rejects duplicate canonical ids and ambiguous route identifiers", () => {
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), space(), space({ slug: "project-one" })],
      })
    ).toThrow(TypeError);
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), space(), space({ id: "space-1" })],
      })
    ).toThrow(TypeError);
  });

  test("requires exactly one default personal Workspace", () => {
    expect(() => parseSpacesResponse({ spaces: [space()] })).toThrow(TypeError);
    expect(() =>
      parseSpacesResponse({
        spaces: [personalSpace(), personalSpace({ id: "personal-2" })],
      })
    ).toThrow(TypeError);
  });
});

test("Workspace mutations require the complete canonical record", () => {
  const created = parseWorkspaceMutationResponse({
    space: space(),
  });
  expect(created.id).toBe("space-1");
  expect(
    parseWorkspaceMutationResponseFor(
      { space: space() },
      {
        id: "space-1",
        isDefault: false,
        name: "Project One",
        description: null,
      },
    ).slug,
  ).toBe("project-one");
  expect(() =>
    parseWorkspaceMutationResponseFor(
      { space: space() },
      { id: "other-space", name: "Project One" },
    )
  ).toThrow("Workspace response does not match the request");
  expect(() =>
    parseWorkspaceMutationResponse({
      space: {
        slug: "project-one",
        name: "Project One",
        is_default: false,
      },
    })
  ).toThrow(TypeError);
});
