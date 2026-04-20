import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals, assertRejects } from "jsr:@std/assert";

import type { Env } from "@/types";
import type { ToolContext } from "@/tools/types";
import {
  SPACE_FILES_CREATE,
  SPACE_FILES_DELETE,
  SPACE_FILES_HANDLERS,
  SPACE_FILES_LIST,
  SPACE_FILES_MKDIR,
  SPACE_FILES_MOVE,
  SPACE_FILES_READ,
  SPACE_FILES_RENAME,
  SPACE_FILES_TOOLS,
  SPACE_FILES_WRITE,
  spaceFilesCreateHandler,
  spaceFilesDeleteHandler,
  spaceFilesMkdirHandler,
  spaceFilesMoveHandler,
  spaceFilesReadHandler,
  spaceFilesRenameHandler,
  spaceFilesWriteHandler,
} from "@/tools/custom/space-files";

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

Deno.test("space files tool definitions - defines all eight tools", () => {
  assertEquals(SPACE_FILES_TOOLS.length, 8);
  const names = SPACE_FILES_TOOLS.map((tool) => tool.name);

  assert(names.includes("space_files_list"));
  assert(names.includes("space_files_read"));
  assert(names.includes("space_files_write"));
  assert(names.includes("space_files_create"));
  assert(names.includes("space_files_mkdir"));
  assert(names.includes("space_files_delete"));
  assert(names.includes("space_files_rename"));
  assert(names.includes("space_files_move"));
});

Deno.test("space files tool definitions - categories and required fields are stable", () => {
  for (const def of SPACE_FILES_TOOLS) {
    assertEquals(def.category, "file");
    assert(def.name in SPACE_FILES_HANDLERS);
  }

  assertEquals(SPACE_FILES_WRITE.parameters.required, ["content"]);
  assertEquals(SPACE_FILES_CREATE.parameters.required, ["path", "content"]);
  assertEquals(SPACE_FILES_MKDIR.parameters.required, ["path"]);
  assertEquals(SPACE_FILES_RENAME.parameters.required, ["new_name"]);
  assertEquals(SPACE_FILES_MOVE.parameters.required, ["parent_path"]);
  assertEquals(SPACE_FILES_LIST.parameters.required, undefined);
  assertEquals(SPACE_FILES_READ.parameters.required, undefined);
  assertEquals(SPACE_FILES_DELETE.parameters.required, undefined);
});

Deno.test("spaceFilesReadHandler - throws when neither file_id nor path is provided", async () => {
  await assertRejects(
    async () => {
      await spaceFilesReadHandler({}, makeContext());
    },
    Error,
    "Either file_id or path is required",
  );
});

Deno.test("spaceFilesReadHandler - throws when storage is not available", async () => {
  await assertRejects(
    async () => {
      await spaceFilesReadHandler(
        { file_id: "f1" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("spaceFilesWriteHandler - validates content, storage, and target selector", async () => {
  await assertRejects(
    async () => {
      await spaceFilesWriteHandler(
        { file_id: "f1", content: 123 },
        makeContext(),
      );
    },
    Error,
    "content must be a string",
  );

  await assertRejects(
    async () => {
      await spaceFilesWriteHandler(
        { file_id: "f1", content: "ok" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );

  await assertRejects(
    async () => {
      await spaceFilesWriteHandler(
        { content: "ok" },
        makeContext(),
      );
    },
    Error,
    "Either file_id or path is required",
  );
});

Deno.test("spaceFilesCreateHandler - validates path, content, and storage", async () => {
  await assertRejects(
    async () => {
      await spaceFilesCreateHandler(
        { path: "", content: "test" },
        makeContext(),
      );
    },
    Error,
    "path is required",
  );

  await assertRejects(
    async () => {
      await spaceFilesCreateHandler(
        { path: "/test.md", content: 123 },
        makeContext(),
      );
    },
    Error,
    "content must be a string",
  );

  await assertRejects(
    async () => {
      await spaceFilesCreateHandler(
        { path: "/test.md", content: "hello" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("spaceFilesMkdirHandler - validates path before storage access", async () => {
  await assertRejects(
    async () => {
      await spaceFilesMkdirHandler({ path: "" }, makeContext());
    },
    Error,
    "path is required",
  );

  await assertRejects(
    async () => {
      await spaceFilesMkdirHandler({ path: "/" }, makeContext());
    },
    Error,
    "path must not be the space root",
  );
});

Deno.test("spaceFilesDeleteHandler - validates selector and storage binding", async () => {
  await assertRejects(
    async () => {
      await spaceFilesDeleteHandler({}, makeContext());
    },
    Error,
    "Either file_id or path is required",
  );

  await assertRejects(
    async () => {
      await spaceFilesDeleteHandler(
        { file_id: "f1" },
        makeContext({ env: {} as Env }),
      );
    },
    Error,
    "Storage not available",
  );
});

Deno.test("spaceFilesRenameHandler - requires new_name after resolving file_id", async () => {
  await assertRejects(
    async () => {
      await spaceFilesRenameHandler(
        { file_id: "f1", new_name: "" },
        makeContext(),
      );
    },
    Error,
    "new_name is required",
  );
});

Deno.test("spaceFilesMoveHandler - requires parent_path after resolving file_id", async () => {
  await assertRejects(
    async () => {
      await spaceFilesMoveHandler(
        { file_id: "f1", parent_path: "" },
        makeContext(),
      );
    },
    Error,
    "parent_path is required",
  );
});
