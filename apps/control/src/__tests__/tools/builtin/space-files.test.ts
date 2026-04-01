import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
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
  workspaceFilesMkdirHandler,
  workspaceFilesMoveHandler,
  workspaceFilesReadHandler,
  workspaceFilesRenameHandler,
  workspaceFilesWriteHandler,
} from "@/tools/builtin/space-files";

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

Deno.test("workspace files tool definitions - defines all eight tools", () => {
  assertEquals(WORKSPACE_FILES_TOOLS.length, 8);
  const names = WORKSPACE_FILES_TOOLS.map((tool) => tool.name);

  assert(names.includes("workspace_files_list"));
  assert(names.includes("workspace_files_read"));
  assert(names.includes("workspace_files_write"));
  assert(names.includes("workspace_files_create"));
  assert(names.includes("workspace_files_mkdir"));
  assert(names.includes("workspace_files_delete"));
  assert(names.includes("workspace_files_rename"));
  assert(names.includes("workspace_files_move"));
});

Deno.test("workspace files tool definitions - categories and required fields are stable", () => {
  for (const def of WORKSPACE_FILES_TOOLS) {
    assertEquals(def.category, "file");
    assert(def.name in WORKSPACE_FILES_HANDLERS);
  }

  assertEquals(WORKSPACE_FILES_WRITE.parameters.required, ["content"]);
  assertEquals(WORKSPACE_FILES_CREATE.parameters.required, ["path", "content"]);
  assertEquals(WORKSPACE_FILES_MKDIR.parameters.required, ["path"]);
  assertEquals(WORKSPACE_FILES_RENAME.parameters.required, ["new_name"]);
  assertEquals(WORKSPACE_FILES_MOVE.parameters.required, ["parent_path"]);
  assertEquals(WORKSPACE_FILES_LIST.parameters.required, undefined);
  assertEquals(WORKSPACE_FILES_READ.parameters.required, undefined);
  assertEquals(WORKSPACE_FILES_DELETE.parameters.required, undefined);
});

Deno.test("workspaceFilesReadHandler - throws when neither file_id nor path is provided", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesReadHandler({}, makeContext());
    },
    Error,
    "Either file_id or path is required",
  );
});

Deno.test("workspaceFilesReadHandler - throws when storage is not available", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesReadHandler(
        { file_id: "f1" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("workspaceFilesWriteHandler - validates content, storage, and target selector", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesWriteHandler(
        { file_id: "f1", content: 123 },
        makeContext(),
      );
    },
    Error,
    "content must be a string",
  );

  await assertRejects(
    async () => {
      await workspaceFilesWriteHandler(
        { file_id: "f1", content: "ok" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );

  await assertRejects(
    async () => {
      await workspaceFilesWriteHandler(
        { content: "ok" },
        makeContext(),
      );
    },
    Error,
    "Either file_id or path is required",
  );
});

Deno.test("workspaceFilesCreateHandler - validates path, content, and storage", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesCreateHandler(
        { path: "", content: "test" },
        makeContext(),
      );
    },
    Error,
    "path is required",
  );

  await assertRejects(
    async () => {
      await workspaceFilesCreateHandler(
        { path: "/test.md", content: 123 },
        makeContext(),
      );
    },
    Error,
    "content must be a string",
  );

  await assertRejects(
    async () => {
      await workspaceFilesCreateHandler(
        { path: "/test.md", content: "hello" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("workspaceFilesMkdirHandler - validates path before storage access", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesMkdirHandler({ path: "" }, makeContext());
    },
    Error,
    "path is required",
  );

  await assertRejects(
    async () => {
      await workspaceFilesMkdirHandler({ path: "/" }, makeContext());
    },
    Error,
    "path must not be the workspace root",
  );
});

Deno.test("workspaceFilesDeleteHandler - validates selector and storage binding", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesDeleteHandler({}, makeContext());
    },
    Error,
    "Either file_id or path is required",
  );

  await assertRejects(
    async () => {
      await workspaceFilesDeleteHandler(
        { file_id: "f1" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("workspaceFilesRenameHandler - requires new_name after resolving file_id", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesRenameHandler(
        { file_id: "f1", new_name: "" },
        makeContext(),
      );
    },
    Error,
    "new_name is required",
  );
});

Deno.test("workspaceFilesMoveHandler - requires parent_path after resolving file_id", async () => {
  await assertRejects(
    async () => {
      await workspaceFilesMoveHandler(
        { file_id: "f1", parent_path: "" },
        makeContext(),
      );
    },
    Error,
    "parent_path is required",
  );
});
