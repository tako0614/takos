import {
  resolveTemplates,
  type TemplateContext,
  validateTemplateReferences,
} from "../app-manifest-template.ts";

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";

const context: TemplateContext = {
  routes: {
    "browser-api": {
      url: "https://browser-api.example.com",
      domain: "browser-api.example.com",
      path: "/api",
    },
    api: {
      url: "https://api.example.com",
      domain: "api.example.com",
      path: "/",
    },
  },
  containers: { headless: { port: 9222 } },
  services: { executor: { ipv4: "10.0.0.1", port: 8080 } },
  workers: {
    "browser-host": { url: "https://browser-host.workers.dev" },
    api: { url: "https://api.workers.dev" },
  },
  resources: {
    "mcp-auth-secret": { id: "secret-abc-123" },
    db: { id: "db-xyz-456" },
  },
};

const manifest = {
  containers: { headless: {} },
  services: { executor: {} },
  workers: { "browser-host": {}, api: {} },
  routes: [{ name: "browser-api" }, { name: "api" }],
  resources: { "mcp-auth-secret": {}, db: {} },
};

Deno.test("resolveTemplates substitutes known template values", () => {
  const result = resolveTemplates(
    {
      API_URL: "{{routes.api.url}}",
      EXECUTOR: "{{services.executor.ipv4}}:{{services.executor.port}}",
    },
    context,
  );

  assertEquals(result, {
    API_URL: "https://api.example.com",
    EXECUTOR: "10.0.0.1:8080",
  });
});

Deno.test("resolveTemplates rejects unknown template values", () => {
  assertThrows(
    () => resolveTemplates({ BAD: "{{routes.nonexistent.url}}" }, context),
    Error,
    "Template variable not found",
  );
});

Deno.test("validateTemplateReferences reports unknown references", () => {
  const errors = validateTemplateReferences(
    {
      A: "{{routes.nope.url}}",
      B: "{{services.nope.port}}",
      C: "{{databases.main.url}}",
    },
    manifest,
  );

  assertEquals(errors.length, 3);
  assertStringIncludes(errors[0], 'route "nope" not found');
  assertStringIncludes(errors[1], 'service "nope" not found');
  assertStringIncludes(errors[2], 'unknown section "databases"');
});
