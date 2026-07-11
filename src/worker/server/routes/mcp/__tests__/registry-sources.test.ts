import { expect, test } from "bun:test";
import { createApiRouter } from "../../api.ts";
import { serializeSource } from "../registry-sources.ts";

test("MCP Registry source CRUD and live search routes are mounted", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const router = createApiRouter({
    requireAuth: noop as never,
    optionalAuth: noop as never,
  });
  const signatures = router.routes.map(
    (route) => `${route.method} ${route.path}`,
  );

  expect(signatures).toContain("GET /mcp/registry-sources");
  expect(signatures).toContain("POST /mcp/registry-sources");
  expect(signatures).toContain("PATCH /mcp/registry-sources/:id");
  expect(signatures).toContain("DELETE /mcp/registry-sources/:id");
  expect(signatures).toContain("GET /mcp/search");
  expect(signatures).toContain("GET /mcp/client.json");
  expect(signatures).toContain("GET /mcp/discover");
  expect(signatures).toContain("GET /mcp/connections/export");
  expect(signatures).toContain("POST /mcp/connections/import");
});

test("Registry source DTO never serializes the encrypted credential", () => {
  const serialized = serializeSource({
    id: "registry_1",
    spaceId: "workspace_1",
    name: "Private metadata",
    baseUrl: "https://registry.example",
    sourceKind: "organization",
    authType: "bearer",
    authHeaderName: null,
    credentialConfigured: true,
    authSecretCiphertext: "encrypted-secret-that-must-not-leak",
    enabled: true,
    priority: 10,
    readOnly: false,
    preview: false,
    bestEffort: true,
    verificationStatus: "not_assessed",
    securityStatus: "not_assessed",
    createdAt: null,
    updatedAt: null,
  });
  expect(JSON.stringify(serialized)).not.toContain("encrypted-secret");
  expect(serialized).toMatchObject({
    auth_type: "bearer",
    credential_configured: true,
  });
});
