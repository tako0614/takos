import { ALL_API_BEARER_SCOPES } from "@/types/api-scopes";

import { assert } from "@std/assert";

Deno.test("API bearer scope registry - does not publish legacy project scopes", () => {
  assert(!ALL_API_BEARER_SCOPES.includes("projects:read"));
  assert(!ALL_API_BEARER_SCOPES.includes("projects:write"));
});
Deno.test("API bearer scope registry - does not publish pre-spaces legacy scope aliases", () => {
  assert(!ALL_API_BEARER_SCOPES.includes("workspaces:read"));
  assert(!ALL_API_BEARER_SCOPES.includes("workspaces:write"));
});
Deno.test("API bearer scope registry - does not publish internal deployment scopes", () => {
  assert(!ALL_API_BEARER_SCOPES.includes("apps:deploy"));
  assert(!ALL_API_BEARER_SCOPES.includes("packages:install"));
});
