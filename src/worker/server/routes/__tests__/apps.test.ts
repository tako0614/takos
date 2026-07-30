import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { Hono } from "hono";

import {
  appsRouteDeps,
  registerAppApiRoutes,
  resolveLauncherIcon,
} from "../apps/routes.ts";

test("launcher icons use the shared Interface display contract", () => {
  assertEquals(
    resolveLauncherIcon(
      "https://cdn.example.test/apps/docs.svg",
      "https://docs.example.test/",
    ),
    "https://cdn.example.test/apps/docs.svg",
  );
  assertEquals(
    resolveLauncherIcon("/icons/docs.svg", "https://docs.example.test/app"),
    "https://docs.example.test/icons/docs.svg",
  );
  assertEquals(resolveLauncherIcon("📄", "https://docs.example.test/"), "📄");

  for (const icon of [
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//cdn.example.test/icon.svg",
    "http://cdn.example.test/icon.svg",
    "https://user:pass@cdn.example.test/icon.svg",
    "https://cdn.example.test/icon.svg#fragment",
    "https://cdn.example.test/icon.svg?access_token=secret",
  ]) {
    assertEquals(
      resolveLauncherIcon(icon, "https://docs.example.test/"),
      null,
      `expected ${icon} to be rejected`,
    );
  }
  assertEquals(resolveLauncherIcon("/icon.svg", null), null);
});

test("app launcher is an authorized Takosumi Interface view", async () => {
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
  const originalResolveAuthorization =
    appsRouteDeps.resolveRuntimeInterfaceAuthorization;
  const originalFetchUiSurfaces =
    appsRouteDeps.fetchAuthorizedUiSurfaceInterfaces;
  const requestedWorkspaces: string[] = [];
  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: {
      user: { id: string; principal_id: string };
      accounts_bearer: {
        accessToken: string;
        subjectId: string;
        workspaceId: string;
      };
    };
  }>();

  app.use("*", async (c, next) => {
    c.set("user", {
      id: "local-user",
      principal_id: "local-principal",
    });
    c.set("accounts_bearer", {
      accessToken: "request-access-token",
      subjectId: "takosumi-principal",
      workspaceId: "takosumi-workspace",
    });
    await next();
  });
  registerAppApiRoutes(app as never);

  try {
    appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
      assertEquals(spaceId, "local-workspace");
      assertEquals(userId, "local-user");
      return { space: { id: "local-workspace-id" } } as never;
    };
    appsRouteDeps.resolveRuntimeInterfaceAuthorization = async (
      _env,
      userId,
      bearer,
    ) => {
      assertEquals(userId, "local-user");
      assertEquals(bearer, {
        accessToken: "request-access-token",
        subjectId: "takosumi-principal",
        workspaceId: "takosumi-workspace",
      });
      return {
        baseUrl: "https://accounts.takosumi.test",
        token: bearer?.accessToken ?? "",
        subjectId: "takosumi-principal",
        workspaceId: "takosumi-workspace",
      };
    };
    appsRouteDeps.fetchAuthorizedUiSurfaceInterfaces = async (
      workspaceId,
      config,
    ) => {
      requestedWorkspaces.push(workspaceId);
      assertEquals(config.subjectId, "takosumi-principal");
      return [
        {
          interface: {
            apiVersion: "takosumi.dev/v1alpha1",
            kind: "Interface",
            metadata: {
              id: "if_docs",
              workspaceId: "takosumi-workspace",
              name: "docs",
              ownerRef: { kind: "Capsule", id: "capsule_docs" },
              generation: 2,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z",
            },
            spec: {
              type: "interface.ui.surface",
              version: "1",
              document: {
                launcher: true,
                display: {
                  title: "Docs",
                  description: "Workspace documents",
                  icon: "/icon.svg",
                  category: "productivity",
                  sortOrder: 4,
                },
              },
              inputs: {
                url: {
                  source: "literal",
                  value: "https://docs.example.test/app",
                },
              },
              access: { visibility: "workspace" },
            },
            status: {
              phase: "Resolved",
              observedGeneration: 2,
              resolvedRevision: 3,
              resolvedInputs: { url: "https://docs.example.test/app" },
            },
          },
          capsuleId: "capsule_docs",
        },
      ] as never;
    };

    const response = await app.request(
      "/apps",
      {
        headers: { "X-Takos-Space-Id": "local-workspace" },
      },
      { DB: {} },
    );
    assertEquals(response.status, 200);
    assertEquals(requestedWorkspaces, ["takosumi-workspace"]);
    const expectedApp = {
      id: "if_docs",
      name: "Docs",
      description: "Workspace documents",
      icon: "https://docs.example.test/icon.svg",
      app_type: "custom",
      url: "https://docs.example.test/app",
      space_id: "local-workspace",
      space_name: null,
      service_hostname: "docs.example.test",
      service_status: "ready",
      source_type: "interface",
      capsule_id: "capsule_docs",
      interface_name: "docs",
      category: "productivity",
      sort_order: 4,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-02T00:00:00.000Z",
    };
    assertEquals(await response.json(), { apps: [expectedApp] });

    const detailResponse = await app.request(
      "/apps/if_docs",
      {
        headers: { "X-Takos-Space-Id": "local-workspace" },
      },
      { DB: {} },
    );
    assertEquals(detailResponse.status, 200);
    assertEquals(requestedWorkspaces, [
      "takosumi-workspace",
      "takosumi-workspace",
    ]);
    assertEquals(await detailResponse.json(), { app: expectedApp });
  } finally {
    appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
    appsRouteDeps.resolveRuntimeInterfaceAuthorization =
      originalResolveAuthorization;
    appsRouteDeps.fetchAuthorizedUiSurfaceInterfaces =
      originalFetchUiSurfaces;
  }
});

test("app Interface views expose no local mutation routes", async () => {
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;

  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: {
      user: { id: string; principal_id: string };
    };
  }>();

  app.use("*", async (c, next) => {
    c.set("user", {
      id: "user-1",
      principal_id: "principal-1",
    });
    await next();
  });

  registerAppApiRoutes(app as never);

  try {
    appsRouteDeps.requireSpaceAccess = async () => {
      throw new Error("unregistered mutation route performed access work");
    };

    const headers = {
      "Content-Type": "application/json",
      "X-Takos-Space-Id": "space-123",
    };

    const patchResponse = await app.request(
      "/apps/app-space-1",
      {
        method: "PATCH",
        headers,
        body: "{not-json",
      },
      { DB: {} },
    );
    assertEquals(patchResponse.status, 404);

    const clientKeyResponse = await app.request(
      "/apps/app-space-1/client-key",
      {
        method: "POST",
        headers: {
          "X-Takos-Space-Id": "space-123",
        },
      },
      { DB: {} },
    );
    assertEquals(clientKeyResponse.status, 404);

    const deleteResponse = await app.request(
      "/apps/app-space-1",
      {
        method: "DELETE",
        headers: {
          "X-Takos-Space-Id": "space-123",
        },
      },
      { DB: {} },
    );
    assertEquals(deleteResponse.status, 404);
  } finally {
    appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
  }
});
