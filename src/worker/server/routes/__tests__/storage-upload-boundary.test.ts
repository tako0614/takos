import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { generalApiBodyLimit } from "../../middleware/body-size.ts";
import { validateContentType } from "../../middleware/content-type.ts";
import { RAW_STORAGE_UPLOAD_PATHS } from "../../middleware/raw-body-routes.ts";
import { MAX_FILE_SIZE } from "../../../application/services/source/space-storage.ts";
import { storageUploadBodyLimit } from "../spaces/storage-uploads.ts";
import { isStorageMimeTypeSafeForInline } from "../spaces/storage-operations.ts";
import { buildStorageZipEntryName } from "../spaces/storage-downloads.ts";

function uploadBoundaryApp(): Hono {
  const app = new Hono();
  app.use(
    "*",
    validateContentType({
      allowedTypes: [
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
      ],
      allowEmptyBody: true,
      skipPaths: RAW_STORAGE_UPLOAD_PATHS,
    }),
  );
  app.use("*", generalApiBodyLimit);
  app.put(
    "/api/spaces/:spaceId/storage/upload/:fileId",
    storageUploadBodyLimit,
    async (c) =>
      c.json({ bytes: (await c.req.arrayBuffer()).byteLength }),
  );
  app.post("/api/json", async (c) => c.json({ accepted: true }));
  return app;
}

describe("raw Storage upload middleware boundary", () => {
  test("accepts binary uploads above the general JSON body limit", async () => {
    const body = new Uint8Array(1024 * 1024 + 1);
    const response = await uploadBoundaryApp().request(
      "/api/spaces/team/storage/upload/file-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: body.byteLength });
  });

  test("retains the general content type and one MiB gates elsewhere", async () => {
    const wrongType = await uploadBoundaryApp().request(
      "/api/json",
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": "1",
        },
        body: "x",
      },
    );
    expect(wrongType.status).toBe(415);

    const oversized = await uploadBoundaryApp().request(
      "/api/json",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(1024 * 1024 + 1),
        },
        body: "{}",
      },
    );
    expect(oversized.status).toBe(413);
  });

  test("rejects uploads above the Storage-specific cap before buffering", async () => {
    const response = await uploadBoundaryApp().request(
      "/api/spaces/team/storage/upload/file-1",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(MAX_FILE_SIZE + 1),
        },
        body: new Uint8Array([1]),
      },
    );

    expect(response.status).toBe(413);
  });

  test("does not broaden the raw-body exception to descendant paths", async () => {
    const response = await uploadBoundaryApp().request(
      "/api/spaces/team/storage/upload/file-1/extra",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": "1",
        },
        body: new Uint8Array([1]),
      },
    );

    expect(response.status).toBe(415);
  });
});

test("Storage download inline policy excludes active document formats", () => {
  expect(isStorageMimeTypeSafeForInline("image/png")).toBe(true);
  expect(isStorageMimeTypeSafeForInline("audio/mpeg; codecs=mp3")).toBe(true);
  expect(isStorageMimeTypeSafeForInline("text/plain; charset=utf-8")).toBe(
    true,
  );
  expect(isStorageMimeTypeSafeForInline("image/svg+xml")).toBe(false);
  expect(isStorageMimeTypeSafeForInline("application/pdf")).toBe(false);
  expect(isStorageMimeTypeSafeForInline("text/html")).toBe(false);
});

test("Storage ZIP entries stay relative to the exact requested folder", () => {
  expect(buildStorageZipEntryName("/docs/report.md", "/")).toBe(
    "docs/report.md",
  );
  expect(buildStorageZipEntryName("/docs/report.md", "/docs")).toBe(
    "report.md",
  );
  expect(() => buildStorageZipEntryName("/other/file", "/docs")).toThrow(
    "invalid file path",
  );
  expect(() => buildStorageZipEntryName("/../secret", "/")).toThrow(
    "invalid file path",
  );
  expect(() => buildStorageZipEntryName("/docs\\secret", "/")).toThrow(
    "invalid file path",
  );
});
