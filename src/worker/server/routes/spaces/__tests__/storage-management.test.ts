import { test } from "bun:test";
import { assertEquals, assertThrows } from "@takos/test/assert";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";

import {
  buildFileHandlerOpenUrl,
  storageManagementRouteDeps,
} from "../storage-management.ts";
import storageManagement from "../storage-management.ts";
import { routeAuthDeps } from "../../route-auth.ts";

type StorageTestEnv = {
  Bindings: { DB: unknown };
  Variables: { user: { id: string; principal_id: string } };
};

function installAppErrorHandler(app: Hono<StorageTestEnv>) {
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as 400 | 500);
    }
    throw error;
  });
}

test("buildFileHandlerOpenUrl replaces :id placeholders", () => {
  assertEquals(
    buildFileHandlerOpenUrl("files.example.com", "/files/:id", "file-123"),
    "https://files.example.com/files/file-123",
  );
});

test("buildFileHandlerOpenUrl URL-encodes file ids", () => {
  assertEquals(
    buildFileHandlerOpenUrl("files.example.com", "/files/:id", "file 123"),
    "https://files.example.com/files/file%20123",
  );
});

test("buildFileHandlerOpenUrl requires a :id path template", () => {
  assertThrows(
    () =>
      buildFileHandlerOpenUrl("files.example.com", "/files/open", "file-123"),
    Error,
    "FileHandler path must include :id",
  );
});

test("file-handler discovery is an authorized Takosumi Interface view", async () => {
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  const originalResolveAuthorization =
    storageManagementRouteDeps.resolveRuntimeInterfaceAuthorization;
  const originalFetchInterfaces =
    storageManagementRouteDeps.fetchAuthorizedRuntimeInterfaces;
  const selectors: unknown[] = [];
  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: {
      user: { id: string; principal_id: string };
    };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "local-user",
      principal_id: "local-principal",
    });
    await next();
  });
  app.route("/", storageManagement as never);

  try {
    routeAuthDeps.requireSpaceAccess = async () =>
      ({ space: { id: "local-workspace" } }) as never;
    storageManagementRouteDeps.resolveRuntimeInterfaceAuthorization =
      async (_env, userId) => {
        assertEquals(userId, "local-user");
        return {
          baseUrl: "https://accounts.takosumi.test",
          token: "delegated-token",
          subjectId: "takosumi-principal",
          workspaceId: "takosumi-workspace",
        };
      };
    storageManagementRouteDeps.fetchAuthorizedRuntimeInterfaces = async (
      selector,
    ) => {
      selectors.push(selector);
      return [
        {
          interface: {
            apiVersion: "takosumi.dev/v1alpha1",
            kind: "Interface",
            metadata: {
              id: "if_markdown",
              workspaceId: "takosumi-workspace",
              name: "markdown",
              ownerRef: { kind: "Capsule", id: "capsule_office" },
              generation: 2,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-02T00:00:00.000Z",
            },
            spec: {
              type: "interface.file.handler",
              version: "1",
              document: {
                display: { title: "Markdown" },
                mimeTypes: ["TEXT/MARKDOWN"],
                extensions: ["md"],
              },
              inputs: {
                openUrl: {
                  source: "literal",
                  value: "https://files.example.test/files/:id",
                },
              },
              access: { visibility: "workspace" },
            },
            status: {
              phase: "Resolved",
              observedGeneration: 2,
              resolvedRevision: 4,
              resolvedInputs: {
                openUrl: "https://files.example.test/files/:id",
              },
            },
          },
          binding: {
            apiVersion: "takosumi.dev/v1alpha1",
            kind: "InterfaceBinding",
            metadata: {
              id: "ifb_markdown",
              workspaceId: "takosumi-workspace",
              generation: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-01T00:00:00.000Z",
            },
            spec: {
              interfaceId: "if_markdown",
              subjectRef: {
                kind: "Principal",
                id: "takosumi-principal",
              },
              permissions: ["file.open"],
              delivery: { type: "none" },
            },
            status: {
              phase: "Ready",
              observedInterfaceRevision: 4,
            },
          },
        },
      ] as never;
    };

    const response = await app.request(
      "/local-workspace/storage/file-handlers?mime=text%2Fmarkdown",
      {},
      { DB: {} },
    );
    assertEquals(response.status, 200);
    assertEquals(selectors, [
      {
        workspaceId: "takosumi-workspace",
        type: "interface.file.handler",
        permission: "file.open",
        deliveryTypes: ["none"],
      },
    ]);
    assertEquals(await response.json(), {
      handlers: [
        {
          id: "if_markdown",
          name: "markdown",
          title: "Markdown",
          mime_types: ["text/markdown"],
          extensions: [".md"],
          open_url: "https://files.example.test/files/:id",
        },
      ],
    });
  } finally {
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
    storageManagementRouteDeps.resolveRuntimeInterfaceAuthorization =
      originalResolveAuthorization;
    storageManagementRouteDeps.fetchAuthorizedRuntimeInterfaces =
      originalFetchInterfaces;
  }
});

test("PATCH storage with move and rename does not fall back to a partial move when rename fails", async () => {
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  const originalMoveAndRenameStorageItem =
    storageManagementRouteDeps.moveAndRenameStorageItem;
  const originalMoveStorageItem = storageManagementRouteDeps.moveStorageItem;
  const originalRenameStorageItem =
    storageManagementRouteDeps.renameStorageItem;

  const calls = {
    combined: 0,
    move: 0,
    rename: 0,
  };

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
  app.onError(() => new Response(null, { status: 500 }));
  app.route("/", storageManagement as never);

  try {
    routeAuthDeps.requireSpaceAccess = async () =>
      ({ space: { id: "space-1" } }) as never;
    storageManagementRouteDeps.moveAndRenameStorageItem = async () => {
      calls.combined += 1;
      throw new Error("rename failed");
    };
    storageManagementRouteDeps.moveStorageItem = async () => {
      calls.move += 1;
      throw new Error("move should not be called");
    };
    storageManagementRouteDeps.renameStorageItem = async () => {
      calls.rename += 1;
      throw new Error("rename should not be called");
    };

    const response = await app.request(
      "/space-1/storage/file-1",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent_path: "/archive",
          name: "renamed-file",
        }),
      },
      { DB: {} },
    );

    assertEquals(response.status >= 400, true);
    assertEquals(calls.combined, 1);
    assertEquals(calls.move, 0);
    assertEquals(calls.rename, 0);
  } finally {
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
    storageManagementRouteDeps.moveAndRenameStorageItem =
      originalMoveAndRenameStorageItem;
    storageManagementRouteDeps.moveStorageItem = originalMoveStorageItem;
    storageManagementRouteDeps.renameStorageItem = originalRenameStorageItem;
  }
});

test("DELETE storage echoes the exact deleted file identity", async () => {
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  const originalDeleteStorageItem =
    storageManagementRouteDeps.deleteStorageItem;
  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: { user: { id: string; principal_id: string } };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1", principal_id: "principal-1" });
    await next();
  });
  installAppErrorHandler(app);
  app.route("/", storageManagement as never);

  try {
    routeAuthDeps.requireSpaceAccess = async () =>
      ({ space: { id: "space-record" } }) as never;
    storageManagementRouteDeps.deleteStorageItem = async (
      _db,
      spaceId,
      fileId,
    ) => {
      assertEquals(spaceId, "space-record");
      assertEquals(fileId, "file-1");
      return ["object-key"];
    };

    const response = await app.request(
      "/team/storage/file-1",
      { method: "DELETE" },
      { DB: {} },
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      success: true,
      file_id: "file-1",
      deleted_count: 2,
    });
  } finally {
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
    storageManagementRouteDeps.deleteStorageItem = originalDeleteStorageItem;
  }
});

test("bulk Storage mutations reject duplicate file identities before writes", async () => {
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  const originalMoveStorageItem = storageManagementRouteDeps.moveStorageItem;
  let moveCalls = 0;
  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: { user: { id: string; principal_id: string } };
  }>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1", principal_id: "principal-1" });
    await next();
  });
  installAppErrorHandler(app);
  app.route("/", storageManagement as never);

  try {
    routeAuthDeps.requireSpaceAccess = async () =>
      ({ space: { id: "space-record" } }) as never;
    storageManagementRouteDeps.moveStorageItem = async () => {
      moveCalls += 1;
      throw new Error("must not run");
    };

    const response = await app.request(
      "/team/storage/bulk-move",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_ids: ["file-1", "file-1"],
          parent_path: "/archive",
        }),
      },
      { DB: {} },
    );
    assertEquals(response.status, 400);
    assertEquals(moveCalls, 0);
  } finally {
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
    storageManagementRouteDeps.moveStorageItem = originalMoveStorageItem;
  }
});

test("bulk Storage delete partitions every requested identity", async () => {
  const originalRequireSpaceAccess = routeAuthDeps.requireSpaceAccess;
  const originalBulkDeleteStorageItems =
    storageManagementRouteDeps.bulkDeleteStorageItems;
  const app = new Hono<StorageTestEnv>();
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1", principal_id: "principal-1" });
    await next();
  });
  installAppErrorHandler(app);
  app.route("/", storageManagement as never);

  try {
    routeAuthDeps.requireSpaceAccess = async () =>
      ({ space: { id: "space-record" } }) as never;
    storageManagementRouteDeps.bulkDeleteStorageItems = async (
      _db,
      spaceId,
      fileIds,
    ) => {
      assertEquals(spaceId, "space-record");
      assertEquals(fileIds, ["file-1", "file-2"]);
      return {
        r2Keys: ["object-key"],
        deletedCount: 1,
        deletedIds: ["file-1"],
        failedIds: ["file-2"],
      };
    };

    const response = await app.request(
      "/team/storage/bulk-delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: ["file-1", "file-2"] }),
      },
      { DB: {} },
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      success: true,
      deleted_count: 1,
      deleted_ids: ["file-1"],
      error_count: 1,
      failed_ids: ["file-2"],
    });
  } finally {
    routeAuthDeps.requireSpaceAccess = originalRequireSpaceAccess;
    storageManagementRouteDeps.bulkDeleteStorageItems =
      originalBulkDeleteStorageItems;
  }
});
