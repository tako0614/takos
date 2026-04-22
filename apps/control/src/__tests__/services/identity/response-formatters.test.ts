import {
  formatRepositoryResponse,
  toUserResponse,
  toWorkspaceResponse,
} from "@/services/identity/response-formatters";
import type { User } from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("formatRepositoryResponse - maps database fields to API response shape", () => {
  const repo = {
    name: "my-repo",
    description: "A test repo",
    visibility: "public",
    defaultBranch: "main",
    stars: 42,
    forks: 3,
    gitEnabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  const result = formatRepositoryResponse(repo, "alice");

  assertEquals(result, {
    owner_username: "alice",
    name: "my-repo",
    description: "A test repo",
    visibility: "public",
    default_branch: "main",
    stars: 42,
    forks: 3,
    git_enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  });
});
Deno.test("formatRepositoryResponse - handles null description", () => {
  const repo = {
    name: "test",
    description: null,
    visibility: "private",
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    gitEnabled: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  const result = formatRepositoryResponse(repo, "bob");
  assertEquals(result.description, null);
  assertEquals(result.git_enabled, 0);
  // Date objects should be converted to ISO strings
  assertEquals(result.created_at, new Date("2026-01-01").toISOString());
});
Deno.test("formatRepositoryResponse - converts Date objects in timestamps", () => {
  const repo = {
    name: "test",
    description: null,
    visibility: "public",
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: new Date("2026-06-15T12:00:00.000Z"),
    updatedAt: new Date("2026-06-16T12:00:00.000Z"),
  };

  const result = formatRepositoryResponse(repo, "user");
  assertEquals(result.created_at, "2026-06-15T12:00:00.000Z");
  assertEquals(result.updated_at, "2026-06-16T12:00:00.000Z");
});

Deno.test("toWorkspaceResponse - maps workspace to API response with defaults", () => {
  const ws = {
    id: "ws-1",
    kind: "team",
    name: "My Team",
    slug: "my-team",
    description: "A team workspace",
    owner_principal_id: "user-1",
    automation_principal_id: null,
    security_posture: "standard" as const,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);

  assertEquals(result, {
    id: "ws-1",
    slug: "my-team",
    name: "My Team",
    description: "A team workspace",
    kind: "team",
    owner_principal_id: "user-1",
    automation_principal_id: null,
    security_posture: "standard",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  });
});
Deno.test("toWorkspaceResponse - uses id as slug fallback when slug is null", () => {
  const ws = {
    id: "ws-fallback",
    name: "Fallback",
    slug: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.slug, "ws-fallback");
});
Deno.test('toWorkspaceResponse - uses "unknown" as slug when both slug and id are missing', () => {
  const ws = {
    name: "No ID",
    slug: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.slug, "unknown");
});
Deno.test("toWorkspaceResponse - defaults kind to team when not specified", () => {
  const ws = {
    name: "NoKind",
    slug: "no-kind",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.kind, "team");
});
Deno.test("toWorkspaceResponse - defaults description to null when not specified", () => {
  const ws = {
    name: "NoDesc",
    slug: "no-desc",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.description, null);
});
Deno.test("toWorkspaceResponse - defaults security_posture to standard when not specified", () => {
  const ws = {
    name: "Default",
    slug: "default",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.security_posture, "standard");
});
Deno.test("toWorkspaceResponse - defaults owner_principal_id to null when not specified", () => {
  const ws = {
    name: "NoOwner",
    slug: "no-owner",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toWorkspaceResponse(ws);
  assertEquals(result.owner_principal_id, null);
});

Deno.test("toUserResponse - maps user to API response without internal id", () => {
  const user: User = {
    id: "internal-id",
    email: "alice@example.com",
    name: "Alice",
    username: "alice",
    bio: "Hello",
    picture: "https://example.com/avatar.png",
    trust_tier: "standard",
    setup_completed: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toUserResponse(user);

  assertEquals(result, {
    email: "alice@example.com",
    name: "Alice",
    username: "alice",
    picture: "https://example.com/avatar.png",
    setup_completed: true,
  });
  assert(!("id" in result));
  assert(!("bio" in result));
  assert(!("trust_tier" in result));
});
Deno.test("toUserResponse - converts falsy setup_completed to false", () => {
  const user: User = {
    id: "internal-id",
    email: "bob@example.com",
    name: "Bob",
    username: "bob",
    bio: null,
    picture: null,
    trust_tier: "standard",
    setup_completed: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const result = toUserResponse(user);
  assertEquals(result.setup_completed, false);
  assertEquals(result.picture, null);
});
