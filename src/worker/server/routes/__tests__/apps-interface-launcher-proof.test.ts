import { test } from "bun:test";
import { Hono } from "hono";
import { assertEquals } from "@takos/test/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";

import { appsRouteDeps, registerAppApiRoutes } from "../apps/index.ts";

test("bounded authorized Interface projection appears on the Takos launcher", async () => {
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
  const originalResolveAuthorization =
    appsRouteDeps.resolveRuntimeInterfaceAuthorization;
  const requests: URL[] = [];
  const accessToken = "request-scoped-accounts-token";
  const app = createAppsRouteHarness(accessToken);

  try {
    appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
      assertEquals(spaceId, "local-workspace");
      assertEquals(userId, "local-user");
      return { space: { id: "space-1" } } as never;
    };
    appsRouteDeps.resolveRuntimeInterfaceAuthorization = async (
      _env,
      userId,
      bearer,
    ) => {
      assertEquals(userId, "local-user");
      assertEquals(bearer, {
        accessToken,
        subjectId: "principal-1",
        workspaceId: "workspace-1",
      });
      return {
        baseUrl: "https://accounts.takosumi.test",
        token: bearer?.accessToken ?? "",
        subjectId: bearer?.subjectId ?? "",
        workspaceId: bearer?.workspaceId ?? "",
        fetch: async (input, init) => {
          const url = new URL(input);
          requests.push(url);
          assertEquals(
            new Headers(init?.headers).get("authorization"),
            `Bearer ${accessToken}`,
          );
          if (
            url.pathname ===
            "/api/v1/workspaces/workspace-1/ui-surfaces"
          ) {
            assertEquals(url.searchParams.get("limit"), "100");
            return Response.json({ interfaces: [resolvedLauncherInterface()] });
          }
          return Response.json({ error: "unexpected path" }, { status: 500 });
        },
      };
    };

    const response = await app.request(
      "/apps",
      { headers: { "X-Takos-Space-Id": "local-workspace" } },
      { DB: {} },
    );

    assertEquals(response.status, 200);
    assertEquals(
      requests.map((request) => request.pathname),
      ["/api/v1/workspaces/workspace-1/ui-surfaces"],
    );
    assertEquals(await response.json(), {
      apps: [
        {
          id: "if_launcher",
          name: "OpenTofu Only",
          description: "Declared by a resolved Takosumi Interface",
          icon: "https://opentofu-only.fixture.test/icon.svg",
          app_type: "custom",
          url: "https://opentofu-only.fixture.test/",
          space_id: "local-workspace",
          space_name: null,
          service_hostname: "opentofu-only.fixture.test",
          service_status: "ready",
          source_type: "interface",
          capsule_id: "cap_launcher",
          interface_name: "launcher",
          category: "test",
          sort_order: 2,
          created_at: "2026-07-30T00:00:00.000Z",
          updated_at: "2026-07-30T00:01:00.000Z",
        },
      ],
    });
  } finally {
    appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
    appsRouteDeps.resolveRuntimeInterfaceAuthorization =
      originalResolveAuthorization;
  }
});

function createAppsRouteHarness(accessToken: string) {
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

  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as never);
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "local-user",
      principal_id: "local-principal",
    });
    c.set("accounts_bearer", {
      accessToken,
      subjectId: "principal-1",
      workspaceId: "workspace-1",
    });
    await next();
  });
  registerAppApiRoutes(app as never);
  return app;
}

function resolvedLauncherInterface() {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id: "if_launcher",
      workspaceId: "workspace-1",
      name: "launcher",
      ownerRef: { kind: "Capsule", id: "cap_launcher" },
      generation: 2,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:01:00.000Z",
    },
    spec: {
      type: "interface.ui.surface",
      version: "1",
      document: {
        launcher: true,
        display: {
          title: "OpenTofu Only",
          description: "Declared by a resolved Takosumi Interface",
          icon: "/icon.svg",
          category: "test",
          sortOrder: 2,
        },
      },
      inputs: {
        url: {
          source: "capsule_output",
          capsuleId: "cap_launcher",
          outputName: "launch_url",
        },
      },
      access: { visibility: "workspace" },
    },
    status: {
      phase: "Resolved",
      observedGeneration: 2,
      resolvedRevision: 4,
      resolvedInputs: { url: "https://opentofu-only.fixture.test/" },
    },
  };
}
