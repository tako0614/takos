import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// [Deno] vi.mock removed - manually stub imports from '@/services/source/space-storage'
import {
  createFileWithContent,
  createFolder,
  deleteR2Objects,
  deleteStorageItem,
  getStorageItemByPath,
  listStorageFiles,
  moveStorageItem,
  readFileContent,
  renameStorageItem,
  writeFileContent,
} from "@/services/source/space-storage";
import type { StorageFileResponse } from "@/services/source/space-storage";

import {
  WORKSPACE_FILES_CREATE,
  WORKSPACE_FILES_DELETE,
  WORKSPACE_FILES_HANDLERS,
  WORKSPACE_FILES_LIST,
  WORKSPACE_FILES_MKDIR,
  WORKSPACE_FILES_MOVE,
  WORKSPACE_FILES_READ,
  WORKSPACE_FILES_RENAME,
  WORKSPACE_FILES_TOOLS,
  WORKSPACE_FILES_WRITE,
  workspaceFilesCreateHandler,
  workspaceFilesDeleteHandler,
  workspaceFilesListHandler,
  workspaceFilesMkdirHandler,
  workspaceFilesMoveHandler,
  workspaceFilesReadHandler,
  workspaceFilesRenameHandler,
  workspaceFilesWriteHandler,
} from "@/tools/builtin/space-files";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

function makeStorageFile(
  overrides:
    & Partial<StorageFileResponse>
    & Pick<StorageFileResponse, "id" | "name" | "type" | "size" | "path">,
): StorageFileResponse {
  return {
    id: overrides.id,
    space_id: overrides.space_id ?? "ws-test",
    parent_id: overrides.parent_id ?? null,
    name: overrides.name,
    path: overrides.path,
    type: overrides.type,
    size: overrides.size,
    mime_type: overrides.mime_type ?? null,
    sha256: overrides.sha256 ?? null,
    uploaded_by: overrides.uploaded_by ?? null,
    created_at: overrides.created_at ?? "2026-03-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("workspace files tool definitions - defines all eight tools", () => {
  assertEquals(WORKSPACE_FILES_TOOLS.length, 8);
  const names = WORKSPACE_FILES_TOOLS.map((t) => t.name);
  assertStringIncludes(names, "workspace_files_list");
  assertStringIncludes(names, "workspace_files_read");
  assertStringIncludes(names, "workspace_files_write");
  assertStringIncludes(names, "workspace_files_create");
  assertStringIncludes(names, "workspace_files_mkdir");
  assertStringIncludes(names, "workspace_files_delete");
  assertStringIncludes(names, "workspace_files_rename");
  assertStringIncludes(names, "workspace_files_move");
});
Deno.test("workspace files tool definitions - all tools have file category", () => {
  for (const def of WORKSPACE_FILES_TOOLS) {
    assertEquals(def.category, "file");
  }
});
Deno.test("workspace files tool definitions - WORKSPACE_FILES_HANDLERS maps all tools", () => {
  for (const def of WORKSPACE_FILES_TOOLS) {
    assert(def.name in WORKSPACE_FILES_HANDLERS);
  }
});
Deno.test("workspace files tool definitions - workspace_files_write requires content", () => {
  assertEquals(WORKSPACE_FILES_WRITE.parameters.required, ["content"]);
});
Deno.test("workspace files tool definitions - workspace_files_create requires path and content", () => {
  assertEquals(WORKSPACE_FILES_CREATE.parameters.required, ["path", "content"]);
});
Deno.test("workspace files tool definitions - workspace_files_mkdir requires path", () => {
  assertEquals(WORKSPACE_FILES_MKDIR.parameters.required, ["path"]);
});
Deno.test("workspace files tool definitions - workspace_files_rename requires new_name", () => {
  assertEquals(WORKSPACE_FILES_RENAME.parameters.required, ["new_name"]);
});
Deno.test("workspace files tool definitions - workspace_files_move requires parent_path", () => {
  assertEquals(WORKSPACE_FILES_MOVE.parameters.required, ["parent_path"]);
});
// ---------------------------------------------------------------------------
// workspaceFilesListHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesListHandler - returns formatted file list", async () => {
  listStorageFiles = (async () => ({
    files: [
      makeStorageFile({
        id: "f1",
        name: "readme.md",
        type: "file",
        size: 1024,
        path: "/readme.md",
      }),
      makeStorageFile({
        id: "f2",
        name: "docs",
        type: "folder",
        size: 0,
        path: "/docs",
      }),
    ],
    truncated: false,
  })) as any;

  const result = await workspaceFilesListHandler({}, makeContext());

  assertStringIncludes(result, "readme.md");
  assertStringIncludes(result, "docs");
  assertStringIncludes(result, "[id: f1]");
  assertStringIncludes(result, "[id: f2]");
});
Deno.test("workspaceFilesListHandler - reports no files found", async () => {
  listStorageFiles = (async () => ({ files: [], truncated: false })) as any;

  const result = await workspaceFilesListHandler({}, makeContext());
  assertStringIncludes(result, "No files found");
});
Deno.test("workspaceFilesListHandler - shows truncation note", async () => {
  listStorageFiles = (async () => ({
    files: [
      makeStorageFile({
        id: "f1",
        name: "a.txt",
        type: "file",
        size: 10,
        path: "/a.txt",
      }),
    ],
    truncated: true,
  })) as any;

  const result = await workspaceFilesListHandler({}, makeContext());
  assertStringIncludes(result, "truncated");
});
Deno.test("workspaceFilesListHandler - formats file sizes correctly", async () => {
  listStorageFiles = (async () => ({
    files: [
      makeStorageFile({
        id: "f1",
        name: "small.txt",
        type: "file",
        size: 100,
        path: "/small.txt",
      }),
      makeStorageFile({
        id: "f2",
        name: "medium.txt",
        type: "file",
        size: 2048,
        path: "/medium.txt",
      }),
      makeStorageFile({
        id: "f3",
        name: "large.txt",
        type: "file",
        size: 2 * 1024 * 1024,
        path: "/large.txt",
      }),
    ],
    truncated: false,
  })) as any;

  const result = await workspaceFilesListHandler({}, makeContext());
  assertStringIncludes(result, "100 B");
  assertStringIncludes(result, "KB");
  assertStringIncludes(result, "MB");
});
// ---------------------------------------------------------------------------
// workspaceFilesReadHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesReadHandler - throws when neither file_id nor path is provided", async () => {
  await assertRejects(async () => {
    await workspaceFilesReadHandler({}, makeContext());
  }, "Either file_id or path is required");
});
Deno.test("workspaceFilesReadHandler - throws when storage not available", async () => {
  const ctx = makeContext({ env: {} as unknown as Env });
  await assertRejects(async () => {
    await workspaceFilesReadHandler({ file_id: "f1" }, ctx);
  }, "Storage not available");
});
Deno.test("workspaceFilesReadHandler - reads a text file by file_id", async () => {
  readFileContent = (async () => ({
    file: makeStorageFile({
      id: "f1",
      name: "readme.md",
      path: "/readme.md",
      type: "file",
      size: 100,
      mime_type: "text/plain",
    }),
    content: "# Hello World",
    encoding: "utf-8",
  })) as any;

  const result = await workspaceFilesReadHandler(
    { file_id: "f1" },
    makeContext(),
  );
  assertStringIncludes(result, "readme.md");
  assertStringIncludes(result, "# Hello World");
});
Deno.test("workspaceFilesReadHandler - reads a file by path", async () => {
  getStorageItemByPath = (async () =>
    makeStorageFile({
      id: "f1",
      type: "file",
      name: "readme.md",
      path: "/readme.md",
      size: 100,
    })) as any;
  readFileContent = (async () => ({
    file: makeStorageFile({
      id: "f1",
      name: "readme.md",
      path: "/readme.md",
      type: "file",
      size: 100,
      mime_type: "text/plain",
    }),
    content: "Content here",
    encoding: "utf-8",
  })) as any;

  const result = await workspaceFilesReadHandler(
    { path: "/readme.md" },
    makeContext(),
  );
  assertStringIncludes(result, "Content here");
});
Deno.test("workspaceFilesReadHandler - throws when path points to a folder", async () => {
  getStorageItemByPath = (async () =>
    makeStorageFile({
      id: "f1",
      type: "folder",
      name: "docs",
      path: "/docs",
      size: 0,
    })) as any;

  await assertRejects(async () => {
    await workspaceFilesReadHandler({ path: "/docs" }, makeContext());
  }, "is a folder");
});
Deno.test("workspaceFilesReadHandler - returns base64 preview for binary files", async () => {
  readFileContent = (async () => ({
    file: makeStorageFile({
      id: "f1",
      name: "image.png",
      path: "/image.png",
      type: "file",
      size: 5000,
      mime_type: "image/png",
    }),
    content: "iVBORw0KGgo=...",
    encoding: "base64",
  })) as any;

  const result = await workspaceFilesReadHandler(
    { file_id: "f1" },
    makeContext(),
  );
  assertStringIncludes(result, "Binary file");
  assertStringIncludes(result, "image.png");
});
// ---------------------------------------------------------------------------
// workspaceFilesWriteHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesWriteHandler - throws when content is not a string", async () => {
  await assertRejects(async () => {
    await workspaceFilesWriteHandler(
      { file_id: "f1", content: 123 },
      makeContext(),
    );
  }, "content must be a string");
});
Deno.test("workspaceFilesWriteHandler - throws when storage not available", async () => {
  const ctx = makeContext({ env: {} as unknown as Env });
  await assertRejects(async () => {
    await workspaceFilesWriteHandler({ file_id: "f1", content: "test" }, ctx);
  }, "Storage not available");
});
Deno.test("workspaceFilesWriteHandler - writes file and returns JSON result", async () => {
  writeFileContent = (async () =>
    makeStorageFile({
      id: "f1",
      name: "test.md",
      type: "file",
      path: "/test.md",
      size: 11,
    })) as any;

  const result = JSON.parse(
    await workspaceFilesWriteHandler(
      { file_id: "f1", content: "new content" },
      makeContext(),
    ),
  );

  assertEquals(result.file.name, "test.md");
});
Deno.test("workspaceFilesWriteHandler - throws when neither file_id nor path is provided", async () => {
  await assertRejects(async () => {
    await workspaceFilesWriteHandler({ content: "test" }, makeContext());
  }, "Either file_id or path is required");
});
// ---------------------------------------------------------------------------
// workspaceFilesCreateHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesCreateHandler - throws when path is empty", async () => {
  await assertRejects(async () => {
    await workspaceFilesCreateHandler(
      { path: "", content: "test" },
      makeContext(),
    );
  }, "path is required");
});
Deno.test("workspaceFilesCreateHandler - throws when content is not a string", async () => {
  await assertRejects(async () => {
    await workspaceFilesCreateHandler(
      { path: "/test.md", content: 123 },
      makeContext(),
    );
  }, "content must be a string");
});
Deno.test("workspaceFilesCreateHandler - creates a file and returns JSON result", async () => {
  createFileWithContent = (async () =>
    makeStorageFile({
      id: "f-new",
      name: "plan.md",
      type: "file",
      path: "/docs/plan.md",
      size: 6,
    })) as any;

  const result = JSON.parse(
    await workspaceFilesCreateHandler(
      { path: "/docs/plan.md", content: "# Plan" },
      makeContext(),
    ),
  );

  assertEquals(result.file.name, "plan.md");
});
// ---------------------------------------------------------------------------
// workspaceFilesMkdirHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesMkdirHandler - throws when path is empty", async () => {
  await assertRejects(async () => {
    await workspaceFilesMkdirHandler({ path: "" }, makeContext());
  }, "path is required");
});
Deno.test("workspaceFilesMkdirHandler - creates a folder", async () => {
  createFolder = (async () =>
    makeStorageFile({
      id: "dir-1",
      name: "specs",
      type: "folder",
      path: "/docs/specs",
      size: 0,
    })) as any;

  const result = JSON.parse(
    await workspaceFilesMkdirHandler({ path: "/docs/specs" }, makeContext()),
  );
  assertEquals(result.folder.name, "specs");
});
// ---------------------------------------------------------------------------
// workspaceFilesDeleteHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesDeleteHandler - deletes an item and returns success", async () => {
  deleteStorageItem = (async () => ["key1", "key2"]) as any;
  deleteR2Objects = (async () => undefined) as any;

  const result = JSON.parse(
    await workspaceFilesDeleteHandler({ file_id: "f1" }, makeContext()),
  );

  assertEquals(result.success, true);
  assertEquals(result.deleted_object_count, 2);
});
Deno.test("workspaceFilesDeleteHandler - handles R2 deletion failure gracefully", async () => {
  deleteStorageItem = (async () => ["key1"]) as any;
  deleteR2Objects = (async () => {
    throw new Error("R2 error");
  }) as any;

  const result = JSON.parse(
    await workspaceFilesDeleteHandler({ file_id: "f1" }, makeContext()),
  );

  assertEquals(result.success, true);
});
// ---------------------------------------------------------------------------
// workspaceFilesRenameHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesRenameHandler - throws when new_name is empty", async () => {
  await assertRejects(async () => {
    await workspaceFilesRenameHandler(
      { file_id: "f1", new_name: "" },
      makeContext(),
    );
  }, "new_name is required");
});
Deno.test("workspaceFilesRenameHandler - renames an item", async () => {
  renameStorageItem = (async () =>
    makeStorageFile({
      id: "f1",
      name: "new-name.md",
      type: "file",
      path: "/new-name.md",
      size: 10,
    })) as any;

  const result = JSON.parse(
    await workspaceFilesRenameHandler(
      { file_id: "f1", new_name: "new-name.md" },
      makeContext(),
    ),
  );

  assertEquals(result.file.name, "new-name.md");
});
// ---------------------------------------------------------------------------
// workspaceFilesMoveHandler
// ---------------------------------------------------------------------------

Deno.test("workspaceFilesMoveHandler - throws when parent_path is empty", async () => {
  await assertRejects(async () => {
    await workspaceFilesMoveHandler(
      { file_id: "f1", parent_path: "" },
      makeContext(),
    );
  }, "parent_path is required");
});
Deno.test("workspaceFilesMoveHandler - moves an item", async () => {
  moveStorageItem = (async () =>
    makeStorageFile({
      id: "f1",
      name: "file.md",
      type: "file",
      path: "/new-dir/file.md",
      size: 7,
    })) as any;

  const result = JSON.parse(
    await workspaceFilesMoveHandler(
      { file_id: "f1", parent_path: "/new-dir" },
      makeContext(),
    ),
  );

  assertEquals(result.file.path, "/new-dir/file.md");
});
