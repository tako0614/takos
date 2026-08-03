import { test } from "bun:test";
import { Hono } from "hono";
import { assertEquals } from "@takos/test/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";

import { fetchAuthorizedUiSurfaceInterfaces } from "../../../application/services/platform/runtime-interface-client.ts";
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
          const uiSurfacesPath =
            "/api/v1/workspaces/workspace-1/ui-surfaces";
          if (
            url.pathname === uiSurfacesPath &&
            url.searchParams.get("cursor") === null
          ) {
            assertEquals(url.searchParams.get("limit"), "100");
            return Response.json({ interfaces: [], nextCursor: "page-2" });
          }
          if (
            url.pathname === uiSurfacesPath &&
            url.searchParams.get("cursor") === "page-2"
          ) {
            assertEquals(url.searchParams.get("limit"), "100");
            assertEquals(url.searchParams.get("cursor"), "page-2");
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
      [
        "/api/v1/workspaces/workspace-1/ui-surfaces",
        "/api/v1/workspaces/workspace-1/ui-surfaces",
      ],
    );
    assertEquals(
      requests.map((request) => request.searchParams.toString()),
      ["limit=100", "limit=100&cursor=page-2"],
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
          interface_name: "takos.launcher",
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

test("launcher projection fails closed for malformed, empty, or repeated cursors", async () => {
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
  const originalResolveAuthorization =
    appsRouteDeps.resolveRuntimeInterfaceAuthorization;
  const accessToken = "request-scoped-accounts-token";
  const cases = [
    {
      name: "empty",
      pages: [{ interfaces: [resolvedLauncherInterface()], nextCursor: "" }],
      expectedRequests: 1,
    },
    {
      name: "malformed",
      pages: [{ interfaces: [resolvedLauncherInterface()], nextCursor: 42 }],
      expectedRequests: 1,
    },
    {
      name: "repeated",
      pages: [
        { interfaces: [resolvedLauncherInterface()], nextCursor: "page-2" },
        { interfaces: [resolvedLauncherInterface()], nextCursor: "page-2" },
      ],
      expectedRequests: 2,
    },
  ] as const;

  try {
    appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
      assertEquals(spaceId, "local-workspace");
      assertEquals(userId, "local-user");
      return { space: { id: "space-1" } } as never;
    };

    for (const testCase of cases) {
      const requests: URL[] = [];
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
            assertEquals(
              url.pathname,
              "/api/v1/workspaces/workspace-1/ui-surfaces",
            );
            assertEquals(url.searchParams.get("limit"), "100");
            assertEquals(
              url.searchParams.get("cursor"),
              requests.length === 1 ? null : "page-2",
            );
            const page = testCase.pages[
              Math.min(requests.length - 1, testCase.pages.length - 1)
            ];
            return Response.json(page);
          },
        };
      };

      const app = createAppsRouteHarness(accessToken);
      const response = await app.request(
        "/apps",
        { headers: { "X-Takos-Space-Id": "local-workspace" } },
        { DB: {} },
      );

      assertEquals(response.status, 200, testCase.name);
      assertEquals(await response.json(), { apps: [] }, testCase.name);
      assertEquals(requests.length, testCase.expectedRequests, testCase.name);
    }
  } finally {
    appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
    appsRouteDeps.resolveRuntimeInterfaceAuthorization =
      originalResolveAuthorization;
  }
});

test("launcher projection echoes opaque cursors without trimming", async () => {
  const opaqueCursor = "  page-2\t";
  const requestedCursors: Array<string | null> = [];
  const authorized = await fetchAuthorizedUiSurfaceInterfaces(
    "workspace-1",
    {
      baseUrl: "https://accounts.takosumi.test",
      token: "request-scoped-accounts-token",
      subjectId: "principal-1",
      fetch: async (input) => {
        const url = new URL(input);
        requestedCursors.push(url.searchParams.get("cursor"));
        if (requestedCursors.length === 1) {
          return Response.json({
            interfaces: [],
            nextCursor: opaqueCursor,
          });
        }
        assertEquals(url.searchParams.get("cursor"), opaqueCursor);
        return Response.json({ interfaces: [resolvedLauncherInterface()] });
      },
    },
  );

  assertEquals(requestedCursors, [null, opaqueCursor]);
  assertEquals(authorized.length, 1);
  assertEquals(authorized[0]?.interface.metadata.id, "if_launcher");
});

test("launcher projection fails closed on aggregate response budget", async () => {
  const requests: URL[] = [];
  const authorized = await fetchAuthorizedUiSurfaceInterfaces(
    "workspace-1",
    {
      baseUrl: "https://accounts.takosumi.test",
      token: "request-scoped-accounts-token",
      subjectId: "principal-1",
      fetch: async (input) => {
        requests.push(new URL(input));
        if (requests.length < 3) {
          return Response.json({
            interfaces: [resolvedLauncherInterface(3 * 1024 * 1024)],
            nextCursor: `next-${requests.length}`,
          });
        }
        return Response.json({
          interfaces: [resolvedLauncherInterface(3 * 1024 * 1024)],
        });
      },
    },
  );

  assertEquals(authorized, []);
  assertEquals(requests.length, 3);
});

test("launcher projection fails closed on aggregate item budget", async () => {
  const requests: URL[] = [];
  const authorized = await fetchAuthorizedUiSurfaceInterfaces(
    "workspace-1",
    {
      baseUrl: "https://accounts.takosumi.test",
      token: "request-scoped-accounts-token",
      subjectId: "principal-1",
      fetch: async (input) => {
        requests.push(new URL(input));
        return Response.json({
          interfaces: Array.from({ length: 513 }, () =>
            resolvedLauncherInterface(),
          ),
        });
      },
    },
  );

  assertEquals(authorized, []);
  assertEquals(requests.length, 1);
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

function resolvedLauncherInterface(paddingBytes = 0) {
  return {
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "Interface",
    metadata: {
      id: "if_launcher",
      workspaceId: "workspace-1",
      name: "takos.launcher",
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
    ...(paddingBytes > 0 ? { padding: "x".repeat(paddingBytes) } : {}),
  };
}
