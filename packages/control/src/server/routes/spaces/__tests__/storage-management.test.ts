import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Hono } from "hono";

import {
  buildFileHandlerOpenUrl,
  projectFileHandlerPublication,
  storageManagementRouteDeps,
} from "../storage-management.ts";
import storageManagement from "../storage-management.ts";
import type { PublicationRecord } from "../../../../application/services/platform/service-publications.ts";

Deno.test("buildFileHandlerOpenUrl replaces :id placeholders", () => {
  assertEquals(
    buildFileHandlerOpenUrl(
      "files.example.com",
      "/files/:id",
      "file-123",
    ),
    "https://files.example.com/files/file-123",
  );
});

Deno.test("buildFileHandlerOpenUrl URL-encodes file ids", () => {
  assertEquals(
    buildFileHandlerOpenUrl(
      "files.example.com",
      "/files/:id",
      "file 123",
    ),
    "https://files.example.com/files/file%20123",
  );
});

Deno.test("buildFileHandlerOpenUrl requires a :id path template", () => {
  assertThrows(
    () =>
      buildFileHandlerOpenUrl("files.example.com", "/files/open", "file-123"),
    Error,
    "FileHandler path must include :id",
  );
});

Deno.test("projectFileHandlerPublication keeps only :id-templated handlers", () => {
  const valid = createPublicationRecord({
    id: "pub_1",
    name: "markdown",
    path: "/files/:id",
    url: "https://files.example.com/files/:id",
  });
  const legacy = createPublicationRecord({
    id: "pub_2",
    name: "legacy",
    path: "/files/open",
    url: "https://files.example.com/files/open",
  });

  assertEquals(projectFileHandlerPublication(valid, 0), {
    idx: 0,
    id: "publication:pub_1",
    name: "markdown",
    title: "Markdown",
    mimeTypes: ["text/markdown"],
    extensions: [".md"],
    open_url: "https://files.example.com/files/:id",
  });
  assertEquals(projectFileHandlerPublication(legacy, 1), null);
});

Deno.test(
  "PATCH storage with move and rename does not fall back to a partial move when rename fails",
  async () => {
    const originalRequireSpaceAccess =
      storageManagementRouteDeps.requireSpaceAccess;
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
      storageManagementRouteDeps.requireSpaceAccess =
        async () => ({ space: { id: "space-1" } } as never);
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
      storageManagementRouteDeps.requireSpaceAccess =
        originalRequireSpaceAccess;
      storageManagementRouteDeps.moveAndRenameStorageItem =
        originalMoveAndRenameStorageItem;
      storageManagementRouteDeps.moveStorageItem = originalMoveStorageItem;
      storageManagementRouteDeps.renameStorageItem = originalRenameStorageItem;
    }
  },
);

function createPublicationRecord(
  options: {
    id: string;
    name: string;
    path: string;
    url: string;
  },
): PublicationRecord {
  return {
    id: options.id,
    name: options.name,
    sourceType: "manifest",
    groupId: "space_1",
    ownerServiceId: "svc_1",
    catalogName: null,
    publicationType: "FileHandler",
    publication: {
      name: options.name,
      publisher: "web",
      type: "FileHandler",
      path: options.path,
      title: "Markdown",
      spec: {
        mimeTypes: ["TEXT/MARKDOWN"],
        extensions: ["md"],
      },
    },
    outputs: [],
    resolved: { url: options.url },
    createdAt: "2026-04-18T00:00:00.000Z",
    updatedAt: "2026-04-18T00:00:00.000Z",
  };
}
