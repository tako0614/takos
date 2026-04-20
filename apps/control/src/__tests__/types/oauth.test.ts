import { ALL_SCOPES } from "@/types/oauth";

import { assert } from "jsr:@std/assert";

Deno.test("OAuth scope registry - does not publish legacy project scopes", () => {
  assert(!ALL_SCOPES.includes("projects:read"));
  assert(!ALL_SCOPES.includes("projects:write"));
});
Deno.test("OAuth scope registry - does not publish pre-spaces legacy scope aliases", () => {
  assert(!ALL_SCOPES.includes("workspaces:read"));
  assert(!ALL_SCOPES.includes("workspaces:write"));
});
Deno.test("OAuth scope registry - does not publish internal deployment scopes as public OAuth scopes", () => {
  assert(!ALL_SCOPES.includes("apps:deploy"));
  assert(!ALL_SCOPES.includes("packages:install"));
});
