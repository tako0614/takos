import {
  normalizeTakosScopes,
  resolveTakosApiUrl,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
  TAKOS_API_URL_ENV_NAME,
} from "../takos-managed.ts";

import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("takos-managed constants are stable", () => {
  assertEquals(TAKOS_API_URL_ENV_NAME, "TAKOS_API_URL");
  assertEquals(TAKOS_ACCESS_TOKEN_ENV_NAME, "TAKOS_ACCESS_TOKEN");
});

Deno.test("resolveTakosApiUrl trims the admin domain", () => {
  assertEquals(
    resolveTakosApiUrl({ ADMIN_DOMAIN: "  api.takos.example  " }),
    "https://api.takos.example",
  );
});

Deno.test("resolveTakosApiUrl returns null without admin domain", () => {
  assertEquals(resolveTakosApiUrl({ ADMIN_DOMAIN: "" }), null);
});

Deno.test("normalizeTakosScopes deduplicates and validates scopes", () => {
  assertEquals(
    normalizeTakosScopes(["spaces:read", " spaces:read ", "spaces:write"]),
    ["spaces:read", "spaces:write"],
  );
});

Deno.test("normalizeTakosScopes rejects empty input", () => {
  assertThrows(() => normalizeTakosScopes([]), Error, "at least one scope");
});

Deno.test("normalizeTakosScopes rejects unknown scopes", () => {
  assertThrows(
    () => normalizeTakosScopes(["definitely-not-a-scope"]),
    Error,
    "Unknown Takos scopes",
  );
});
