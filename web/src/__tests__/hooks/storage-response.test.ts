import { describe, expect, test } from "bun:test";
import {
  buildStorageDownloadUrl,
  parseStorageBulkDeleteResponse,
  parseStorageBulkMutationResponse,
  parseStorageContentResponse,
  parseStorageDeleteResponse,
  parseStorageFileMutationResponse,
  parseStorageListResponse,
  parseStorageUploadUrlResponse,
} from "../../hooks/storage-response.ts";
import type { StorageFile } from "../../types/index.ts";

const now = "2026-08-10T15:00:00.000Z";
const futureExpiry = "2099-08-10T15:15:00.000Z";

function file(overrides: Partial<StorageFile> = {}): StorageFile {
  return {
    id: "file-1",
    space_id: "space-record",
    parent_id: null,
    name: "report.md",
    path: "/report.md",
    type: "file",
    size: 12,
    mime_type: "text/markdown",
    sha256: null,
    uploaded_by: "principal-owner",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Storage record and list response parsing", () => {
  test("accepts one exact Workspace-fenced listing", () => {
    expect(parseStorageListResponse({
      files: [file()],
      path: "/",
      truncated: false,
    }, { spaceId: "space-record", path: "/" })).toEqual({
      files: [file()],
      path: "/",
      truncated: false,
    });
  });

  test("rejects cross-Workspace, duplicate, path, and file-shape drift", () => {
    expect(() =>
      parseStorageListResponse({
        files: [file({ space_id: "other-space" })],
        path: "/",
        truncated: false,
      }, { spaceId: "space-record", path: "/" })
    ).toThrow(TypeError);
    expect(() =>
      parseStorageListResponse({
        files: [file(), file()],
        path: "/",
        truncated: false,
      }, { spaceId: "space-record", path: "/" })
    ).toThrow("Duplicate Storage file identity");
    expect(() =>
      parseStorageListResponse({
        files: [file({ path: "/other.md" })],
        path: "/",
        truncated: false,
      }, { spaceId: "space-record", path: "/" })
    ).toThrow(TypeError);
    expect(() =>
      parseStorageListResponse({ files: [], path: "/", truncated: "false" }, {
        spaceId: "space-record",
        path: "/",
      })
    ).toThrow(TypeError);
  });
});

test("Storage content and mutations require the requested record", () => {
  expect(parseStorageContentResponse({
    content: "# report",
    encoding: "utf-8",
    file: file(),
  }, { spaceId: "space-record", fileId: "file-1" }).content).toBe("# report");
  expect(() =>
    parseStorageContentResponse({
      content: "secret",
      encoding: "utf-8",
      file: file({ space_id: "other-space" }),
    }, { spaceId: "space-record", fileId: "file-1" })
  ).toThrow(TypeError);
  expect(() =>
    parseStorageFileMutationResponse({ file: file({ id: "file-2" }) }, {
      spaceId: "space-record",
      id: "file-1",
    })
  ).toThrow("Storage response does not match the request");
  expect(parseStorageFileMutationResponse({ folder: file({
    id: "folder-1",
    name: "docs",
    path: "/docs",
    type: "folder",
    size: 0,
    mime_type: null,
  }) }, {
    field: "folder",
    spaceId: "space-record",
    name: "docs",
    parentPath: "/",
  }).id).toBe("folder-1");
});

test("Storage upload URLs stay on the exact internal route", () => {
  expect(parseStorageUploadUrlResponse({
    file_id: "file-1",
    upload_url: "/api/spaces/team/storage/upload/file-1",
    expires_at: futureExpiry,
  }, "team").fileId).toBe("file-1");
  expect(() =>
    parseStorageUploadUrlResponse({
      file_id: "file-1",
      upload_url: "https://attacker.example/upload",
      expires_at: futureExpiry,
    }, "team")
  ).toThrow("Unsafe Storage URL");
  expect(() =>
    parseStorageUploadUrlResponse({
      file_id: "file-1",
      upload_url: "/api/spaces/team/storage/upload/file-1",
      r2_key: "must-not-cross-boundary",
      expires_at: futureExpiry,
    }, "team")
  ).toThrow(TypeError);
  expect(() =>
    parseStorageUploadUrlResponse({
      file_id: "file-1",
      upload_url: "/api/spaces/team/storage/upload/file-1",
      expires_at: "2000-01-01T00:00:00.000Z",
    }, "team")
  ).toThrow("Expired Storage upload URL");
});

test("Storage downloads use the stable authenticated internal route", () => {
  expect(buildStorageDownloadUrl("team space", "file/1")).toBe(
    "/api/spaces/team%20space/storage/download/file%2F1",
  );
  expect(() => buildStorageDownloadUrl("", "file-1")).toThrow(TypeError);
});

test("Storage delete responses echo the exact target", () => {
  expect(parseStorageDeleteResponse({
    success: true,
    file_id: "file-1",
    deleted_count: 1,
  }, "file-1")).toBeUndefined();
  expect(() =>
    parseStorageDeleteResponse({
      success: true,
      file_id: "file-2",
      deleted_count: 1,
    }, "file-1")
  ).toThrow(TypeError);
  expect(parseStorageBulkDeleteResponse({
    success: true,
    deleted_count: 1,
    deleted_ids: ["file-1"],
    error_count: 1,
    failed_ids: ["file-2"],
  }, ["file-1", "file-2"])).toEqual({ complete: false });
  expect(() =>
    parseStorageBulkDeleteResponse({
      success: true,
      deleted_count: 0,
      deleted_ids: [],
      error_count: 0,
      failed_ids: [],
    }, ["file-1"])
  ).toThrow("Storage bulk delete response does not match request");
});

test("Storage bulk partial success is valid but never complete", () => {
  const result = parseStorageBulkMutationResponse({
    moved: [file({ path: "/archive/report.md", parent_id: "folder-archive" })],
    errors: [{ file_id: "file-2", error: "conflict" }],
    success_count: 1,
    error_count: 1,
  }, {
    field: "moved",
    spaceId: "space-record",
    fileIds: ["file-1", "file-2"],
    parentPath: "/archive",
  });
  expect(result).toEqual({ complete: false });
  expect(() =>
    parseStorageBulkMutationResponse({
      moved: [],
      errors: [],
      success_count: 0,
      error_count: 0,
    }, {
      field: "moved",
      spaceId: "space-record",
      fileIds: ["file-1"],
      parentPath: "/archive",
    })
  ).toThrow("Storage bulk response does not match the request");
});
