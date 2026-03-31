import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mockCallSessionApi = ((..._args: any[]) => undefined) as any;
const mockRequireContainer = ((..._args: any[]) => undefined) as any;
const mockResolveMountPath = ((..._args: any[]) => undefined) as any;
const mockBuildSessionPath = ((..._args: any[]) => undefined) as any;
const mockSetupFileOperation = ((..._args: any[]) => undefined) as any;
const mockHandleSessionApiResponse = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin/file/session'
// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin/file/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin/file/limits'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import {
  FILE_COPY,
  FILE_DELETE,
  FILE_LIST,
  FILE_MKDIR,
  FILE_READ,
  FILE_RENAME,
  FILE_TOOLS,
  FILE_WRITE,
  FILE_WRITE_BINARY,
} from "@/tools/builtin/file/definitions";
import {
  FILE_HANDLERS,
  fileCopyHandler,
  fileDeleteHandler,
  fileListHandler,
  fileMkdirHandler,
  fileReadHandler,
  fileRenameHandler,
  fileWriteBinaryHandler,
  fileWriteHandler,
} from "@/tools/builtin/file";
import {
  BINARY_EXTENSIONS,
  isBinaryFile,
  validateBinaryContent,
  validateContent,
} from "@/tools/builtin/file/limits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    sessionId: "session-1",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {
      RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    } as unknown as Env,
    db: {} as D1Database,
    storage: {
      put: ((..._args: any[]) => undefined) as any,
      get: ((..._args: any[]) => undefined) as any,
      delete: ((..._args: any[]) => undefined) as any,
      list: async () => ({ objects: [] }),
    } as unknown as ToolContext["storage"],
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

Deno.test("file tool definitions - defines all eight file tools", () => {
  assertEquals(FILE_TOOLS.length, 8);
  const names = FILE_TOOLS.map((t) => t.name);
  assertStringIncludes(names, "file_read");
  assertStringIncludes(names, "file_write");
  assertStringIncludes(names, "file_write_binary");
  assertStringIncludes(names, "file_list");
  assertStringIncludes(names, "file_delete");
  assertStringIncludes(names, "file_mkdir");
  assertStringIncludes(names, "file_rename");
  assertStringIncludes(names, "file_copy");
});
Deno.test("file tool definitions - all tools have file category", () => {
  for (const def of FILE_TOOLS) {
    assertEquals(def.category, "file");
  }
});
Deno.test("file tool definitions - file_read requires path", () => {
  assertEquals(FILE_READ.parameters.required, ["path"]);
});
Deno.test("file tool definitions - file_write requires path and content", () => {
  assertEquals(FILE_WRITE.parameters.required, ["path", "content"]);
});
Deno.test("file tool definitions - file_write_binary requires path and content_base64", () => {
  assertEquals(FILE_WRITE_BINARY.parameters.required, [
    "path",
    "content_base64",
  ]);
});
Deno.test("file tool definitions - file_rename requires old_path and new_path", () => {
  assertEquals(FILE_RENAME.parameters.required, ["old_path", "new_path"]);
});
Deno.test("file tool definitions - file_copy requires source_path and dest_path", () => {
  assertEquals(FILE_COPY.parameters.required, ["source_path", "dest_path"]);
});
Deno.test("file tool definitions - file_delete requires path", () => {
  assertEquals(FILE_DELETE.parameters.required, ["path"]);
});
Deno.test("file tool definitions - file_mkdir requires path", () => {
  assertEquals(FILE_MKDIR.parameters.required, ["path"]);
});
Deno.test("file tool definitions - file_list has no required parameters", () => {
  assertEquals(FILE_LIST.parameters.required, []);
});
Deno.test("file tool definitions - FILE_HANDLERS maps all tools", () => {
  assertEquals(Object.keys(FILE_HANDLERS).length, 8);
  for (const def of FILE_TOOLS) {
    assert(def.name in FILE_HANDLERS);
  }
});
Deno.test("file tool definitions - file tools support repo_id and mount_path parameters", () => {
  for (const def of FILE_TOOLS) {
    assert("repo_id" in def.parameters.properties);
    assert("mount_path" in def.parameters.properties);
  }
});
// ---------------------------------------------------------------------------
// limits module
// ---------------------------------------------------------------------------

Deno.test("file limits - isBinaryFile detects binary extensions", () => {
  assertEquals(isBinaryFile("photo.png"), true);
  assertEquals(isBinaryFile("image.jpg"), true);
});
Deno.test("file limits - BINARY_EXTENSIONS contains expected extensions", () => {
  assert(BINARY_EXTENSIONS !== undefined);
});
// ---------------------------------------------------------------------------
// file_read handler
// ---------------------------------------------------------------------------

Deno.test("fileReadHandler - reads a text file", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockSetupFileOperation = (async () => ({
    path: "src/index.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ content: "hello world", size: 11 })) as any;
  mockHandleSessionApiResponse =
    (async () => ({ content: "hello world", size: 11 })) as any;

  const result = await fileReadHandler({ path: "src/index.ts" }, makeContext());
  assertEquals(result, "hello world");
});
Deno.test("fileReadHandler - reads a binary file as base64 preview", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockSetupFileOperation = (async () => ({
    path: "logo.png",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({
    content: "iVBORw0KGgo=",
    size: 1024,
    is_binary: true,
  });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => ({
    content: "iVBORw0KGgo=",
    size: 1024,
    is_binary: true,
  })) as any;

  const result = await fileReadHandler({ path: "logo.png" }, makeContext());

  assertStringIncludes(result, "[Binary file: logo.png]");
  assertStringIncludes(result, "1024 bytes");
});
Deno.test("fileReadHandler - throws when file not found (404)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockSetupFileOperation = (async () => ({
    path: "missing.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "not found" }, 404)) as any;

  await assertRejects(async () => {
    await fileReadHandler({ path: "missing.ts" }, makeContext());
  }, "File not found");
});
Deno.test("fileReadHandler - throws on non-ok response via handleSessionApiResponse", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockSetupFileOperation = (async () => ({
    path: "test.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({ error: "disk full" }, 500);
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => {
    throw new Error("disk full");
  }) as any;

  await assertRejects(async () => {
    await fileReadHandler({ path: "test.ts" }, makeContext());
  }, "disk full");
});
Deno.test("fileReadHandler - truncates base64 content at 200 characters for binary preview", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  const longBase64 = "A".repeat(300);
  mockSetupFileOperation = (async () => ({
    path: "big.png",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockCallSessionApi = (async () =>
    makeJsonResponse({
      content: longBase64,
      size: 5000,
      is_binary: true,
    })) as any;
  mockHandleSessionApiResponse =
    (async () => ({ content: longBase64, size: 5000, is_binary: true })) as any;

  const result = await fileReadHandler({ path: "big.png" }, makeContext());

  assertStringIncludes(result, "...");
  assertStringIncludes(result, "[Binary file: big.png]");
});
// ---------------------------------------------------------------------------
// file_write handler
// ---------------------------------------------------------------------------

Deno.test("fileWriteHandler - writes a file and returns success message", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "src/index.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  const response = makeJsonResponse({ path: "src/index.ts", size: 22 });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse =
    (async () => ({ path: "src/index.ts", size: 22 })) as any;

  const result = await fileWriteHandler(
    { path: "src/index.ts", content: 'console.log("hello")' },
    makeContext(),
  );

  assertStringIncludes(result, "Written file");
  assertStringIncludes(result, "22 bytes");
});
Deno.test("fileWriteHandler - throws when runtime write fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "src/index.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockCallSessionApi = (async () => {
    throw new Error("connection refused");
  }) as any;

  await assertRejects(async () => {
    await fileWriteHandler({ path: "test.ts", content: "test" }, makeContext());
  }, "Failed to write file");
});
Deno.test("fileWriteHandler - calls validateContent with content and path", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "src/index.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  const response = makeJsonResponse({ path: "src/app.ts", size: 10 });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse =
    (async () => ({ path: "src/app.ts", size: 10 })) as any;

  await fileWriteHandler(
    { path: "src/app.ts", content: "test content" },
    makeContext(),
  );

  assertSpyCallArgs(validateContent, 0, ["test content", "src/index.ts"]);
});
Deno.test("fileWriteHandler - writes to R2 backup alongside runtime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "src/index.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  const ctx = makeContext();
  const response = makeJsonResponse({ path: "src/main.ts", size: 5 });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse =
    (async () => ({ path: "src/main.ts", size: 5 })) as any;

  await fileWriteHandler(
    { path: "src/main.ts", content: "hello" },
    ctx,
  );

  assert(ctx.storage!.put.calls.length > 0);
});
// ---------------------------------------------------------------------------
// file_list handler
// ---------------------------------------------------------------------------

Deno.test("fileListHandler - lists files with sorting (dirs first)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path || "" as any;
  mockCallSessionApi = (async () =>
    makeJsonResponse({
      entries: [
        { name: "file.ts", type: "file", size: 100 },
        { name: "src", type: "dir" },
        { name: "app.ts", type: "file", size: 200 },
      ],
    })) as any;
  mockHandleSessionApiResponse = (async () => ({
    entries: [
      { name: "file.ts", type: "file", size: 100 },
      { name: "src", type: "dir" },
      { name: "app.ts", type: "file", size: 200 },
    ],
  })) as any;

  const result = await fileListHandler({}, makeContext());

  // Directories should come first
  const lines = result.split("\n");
  assertStringIncludes(lines[0], "src/");
  assertStringIncludes(lines[1], "app.ts");
  assertStringIncludes(lines[2], "file.ts");
});
Deno.test("fileListHandler - returns message when no files found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path || "" as any;
  mockCallSessionApi = (async () => makeJsonResponse({ entries: [] })) as any;
  mockHandleSessionApiResponse = (async () => ({ entries: [] })) as any;

  const result = await fileListHandler({}, makeContext());
  assertStringIncludes(result, "No files found");
});
Deno.test("fileListHandler - throws when list fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path || "" as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "session lost" }, 500)) as any;
  mockHandleSessionApiResponse = (async () => {
    throw new Error("session lost");
  }) as any;

  await assertRejects(async () => {
    await fileListHandler({}, makeContext());
  }, "session lost");
});
Deno.test("fileListHandler - sorts files alphabetically within type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation =
    (async () => ({ path: "", mountPath: "", sessionId: "session-1" })) as any;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path || "" as any;
  mockCallSessionApi = (async () =>
    makeJsonResponse({
      entries: [
        { name: "zebra.ts", type: "file", size: 10 },
        { name: "alpha.ts", type: "file", size: 20 },
        { name: "beta", type: "dir" },
        { name: "alpha", type: "dir" },
      ],
    })) as any;
  mockHandleSessionApiResponse = (async () => ({
    entries: [
      { name: "zebra.ts", type: "file", size: 10 },
      { name: "alpha.ts", type: "file", size: 20 },
      { name: "beta", type: "dir" },
      { name: "alpha", type: "dir" },
    ],
  })) as any;

  const result = await fileListHandler({}, makeContext());
  const lines = result.split("\n");

  // Dirs first, then files, both alphabetically sorted
  assertStringIncludes(lines[0], "alpha/");
  assertStringIncludes(lines[1], "beta/");
  assertStringIncludes(lines[2], "alpha.ts");
  assertStringIncludes(lines[3], "zebra.ts");
});
// ---------------------------------------------------------------------------
// file_write_binary handler
// ---------------------------------------------------------------------------

Deno.test("fileWriteBinaryHandler - writes binary content and returns success message", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("hello binary");
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "image.png", size: 12 })) as any;

  const ctx = makeContext();
  const result = await fileWriteBinaryHandler(
    { path: "image.png", content_base64: validBase64 },
    ctx,
  );

  assertStringIncludes(result, "Written binary file");
  assertStringIncludes(result, "12 bytes");
});
Deno.test("fileWriteBinaryHandler - throws on invalid base64 content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  // atob will throw on completely invalid base64
  mockCallSessionApi = (async () => {
    throw new Error("should not be called");
  }) as any;

  // The handler decodes base64 before the API call. Invalid base64 should throw.
  // We need to craft a string that is truly invalid for atob.
  // The handler catches the atob error and throws 'Invalid base64 content'.
  // However, the callSessionApi and storage calls are made in Promise.allSettled,
  // and the base64 decode happens before that. Let's verify the flow.
  const ctx = makeContext();

  // Using a string that will fail atob
  await assertRejects(async () => {
    await fileWriteBinaryHandler(
      { path: "bad.png", content_base64: "!!!invalid-base64!!!" },
      ctx,
    );
  }, "Invalid base64 content");
});
Deno.test("fileWriteBinaryHandler - calls validateBinaryContent for size limit checks", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("small content");
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "icon.png", size: 13 })) as any;

  await fileWriteBinaryHandler(
    { path: "icon.png", content_base64: validBase64 },
    makeContext(),
  );

  assertSpyCallArgs(validateBinaryContent, 0, [validBase64, "icon.png"]);
});
Deno.test("fileWriteBinaryHandler - calls requireContainer to verify session", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("content");
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "file.png", size: 7 })) as any;

  const ctx = makeContext();
  await fileWriteBinaryHandler(
    { path: "file.png", content_base64: validBase64 },
    ctx,
  );

  assertSpyCallArgs(mockRequireContainer, 0, [ctx]);
});
Deno.test("fileWriteBinaryHandler - writes to R2 backup alongside runtime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("binary data");
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "data.bin", size: 11 })) as any;

  const ctx = makeContext();
  await fileWriteBinaryHandler(
    { path: "data.bin", content_base64: validBase64 },
    ctx,
  );

  assert(ctx.storage!.put.calls.length > 0);
});
Deno.test("fileWriteBinaryHandler - throws when runtime binary write fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("content");
  mockCallSessionApi = (async () => {
    throw new Error("runtime down");
  }) as any;

  const ctx = makeContext();
  await assertRejects(async () => {
    await fileWriteBinaryHandler(
      { path: "image.png", content_base64: validBase64 },
      ctx,
    );
  }, "Failed to write binary file");
});
Deno.test("fileWriteBinaryHandler - throws when response is not ok", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const validBase64 = btoa("content");
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "quota exceeded" }, 413)) as any;

  const ctx = makeContext();
  await assertRejects(async () => {
    await fileWriteBinaryHandler(
      { path: "large.png", content_base64: validBase64 },
      ctx,
    );
  }, "quota exceeded");
});
// ---------------------------------------------------------------------------
// file_delete handler
// ---------------------------------------------------------------------------

Deno.test("fileDeleteHandler - deletes a file and returns success message", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({ deleted: true });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => ({ deleted: true })) as any;

  const ctx = makeContext();
  const result = await fileDeleteHandler({ path: "old-file.ts" }, ctx);

  assertEquals(result, "Deleted file: old-file.ts");
});
Deno.test("fileDeleteHandler - throws when file not found (404)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "not found" }, 404)) as any;

  await assertRejects(async () => {
    await fileDeleteHandler({ path: "missing.ts" }, makeContext());
  }, "File not found: old-file.ts");
});
Deno.test("fileDeleteHandler - throws when runtime delete fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  mockCallSessionApi = (async () => {
    throw new Error("connection lost");
  }) as any;

  await assertRejects(async () => {
    await fileDeleteHandler({ path: "file.ts" }, makeContext());
  }, "Failed to delete file");
});
Deno.test("fileDeleteHandler - also deletes from R2 backup", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({ deleted: true });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => ({ deleted: true })) as any;

  const ctx = makeContext();
  await fileDeleteHandler({ path: "file.ts" }, ctx);

  assertSpyCallArgs(ctx.storage!.delete, 0, [
    "session-files/ws-test/session-1/old-file.ts",
  ]);
});
Deno.test("fileDeleteHandler - handles R2 delete failure gracefully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({ deleted: true });
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => ({ deleted: true })) as any;

  const ctx = makeContext();
  (ctx.storage!.delete as any) = (async () => {
    throw new Error("R2 error");
  }) as any;

  // Should not throw despite R2 failure
  const result = await fileDeleteHandler({ path: "file.ts" }, ctx);
  assertEquals(result, "Deleted file: old-file.ts");
});
Deno.test("fileDeleteHandler - throws non-404 error via handleSessionApiResponse", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSetupFileOperation = (async () => ({
    path: "old-file.ts",
    mountPath: "",
    sessionId: "session-1",
  })) as any;
  const response = makeJsonResponse({ error: "internal error" }, 500);
  mockCallSessionApi = (async () => response) as any;
  mockHandleSessionApiResponse = (async () => {
    throw new Error("internal error");
  }) as any;

  await assertRejects(async () => {
    await fileDeleteHandler({ path: "file.ts" }, makeContext());
  }, "internal error");
});
// ---------------------------------------------------------------------------
// file_mkdir handler
// ---------------------------------------------------------------------------

Deno.test("fileMkdirHandler - creates a directory by writing a .gitkeep file", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) =>
    path.replace(/\/+$/, "") as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ path: "new-dir/.gitkeep", size: 0 })) as any;

  const result = await fileMkdirHandler({ path: "new-dir" }, makeContext());

  assertStringIncludes(result, "Created directory");
  assertStringIncludes(result, "new-dir/");

  // Verify it writes a .gitkeep file
  assertSpyCallArgs(mockCallSessionApi, 0, [
    expect.anything(),
    "/session/file/write",
    {
      path: "new-dir/.gitkeep",
      content: "",
    },
  ]);
});
Deno.test("fileMkdirHandler - strips trailing slashes from path", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) =>
    path.replace(/\/+$/, "") as any;
  mockRequireContainer = (() => undefined) as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "my-dir/.gitkeep", size: 0 })) as any;

  await fileMkdirHandler({ path: "my-dir/" }, makeContext());

  // buildSessionPath receives the path without trailing slash
  assertSpyCallArgs(mockBuildSessionPath, 0, ["", "my-dir"]);
});
Deno.test("fileMkdirHandler - throws when creation fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) =>
    path.replace(/\/+$/, "") as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "permission denied" }, 403)) as any;

  await assertRejects(async () => {
    await fileMkdirHandler({ path: "restricted-dir" }, makeContext());
  }, "permission denied");
});
Deno.test("fileMkdirHandler - calls requireContainer to verify session", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) =>
    path.replace(/\/+$/, "") as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ path: "dir/.gitkeep", size: 0 })) as any;

  const ctx = makeContext();
  await fileMkdirHandler({ path: "dir" }, ctx);

  assertSpyCallArgs(mockRequireContainer, 0, [ctx]);
});
Deno.test("fileMkdirHandler - handles already-exists case (server returns success for idempotent write)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) =>
    path.replace(/\/+$/, "") as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ path: "existing-dir/.gitkeep", size: 0 })) as any;

  const result = await fileMkdirHandler(
    { path: "existing-dir" },
    makeContext(),
  );
  assertStringIncludes(result, "Created directory");
});
// ---------------------------------------------------------------------------
// file_rename handler
// ---------------------------------------------------------------------------

Deno.test("fileRenameHandler - renames a text file successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  // First call: read old file
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "file content", is_binary: false })) as any =
    // Second call: write new file
    (async () => makeJsonResponse({ path: "new-name.ts", size: 12 })) as any =
      // Third call: delete old file
      (async () => makeJsonResponse({ deleted: true })) as any;

  const ctx = makeContext();
  const result = await fileRenameHandler(
    { old_path: "old-name.ts", new_path: "new-name.ts" },
    ctx,
  );

  assertEquals(result, "Renamed: old-name.ts -> new-name.ts");
});
Deno.test("fileRenameHandler - throws when source file not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "not found" }, 404)) as any;

  await assertRejects(async () => {
    await fileRenameHandler(
      { old_path: "missing.ts", new_path: "new.ts" },
      makeContext(),
    );
  }, "Source file not found: missing.ts");
});
Deno.test("fileRenameHandler - throws when write to new path fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "data", is_binary: false })) as any =
      (async () => makeJsonResponse({ error: "conflict" }, 409)) as any;

  await assertRejects(async () => {
    await fileRenameHandler(
      { old_path: "a.ts", new_path: "b.ts" },
      makeContext(),
    );
  }, "conflict");
});
Deno.test("fileRenameHandler - renames a binary file (reads as base64, writes as binary)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const base64Content = btoa("binary data");
  // isBinaryFile mock returns true for .png
  mockBuildSessionPath = (_mount: string, path: string) => path as any;

  mockCallSessionApi =
    (async () =>
      makeJsonResponse({
        content: base64Content,
        is_binary: true,
        encoding: "base64",
      })) as any =
    (async () => makeJsonResponse({ path: "new-logo.png", size: 11 })) as any =
      (async () => makeJsonResponse({ deleted: true })) as any;

  const ctx = makeContext();
  const result = await fileRenameHandler(
    { old_path: "logo.png", new_path: "new-logo.png" },
    ctx,
  );

  assertEquals(result, "Renamed: logo.png -> new-logo.png");

  // Should have used write-binary endpoint for the second call
  assertSpyCallArgs(mockCallSessionApi, 0, [
    expect.anything(),
    "/session/file/write-binary",
    { content_base64: base64Content },
  ]);
});
Deno.test("fileRenameHandler - updates R2 backup (writes new key, deletes old key)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "content", is_binary: false })) as any =
    (async () => makeJsonResponse({ path: "new.ts", size: 7 })) as any =
      (async () => makeJsonResponse({ deleted: true })) as any;

  const ctx = makeContext();
  await fileRenameHandler(
    { old_path: "old.ts", new_path: "new.ts" },
    ctx,
  );

  assert(ctx.storage!.put.calls.length > 0);
  assert(ctx.storage!.delete.calls.length > 0);
});
Deno.test("fileRenameHandler - calls requireContainer to verify session", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "data", is_binary: false })) as any =
    (async () => makeJsonResponse({ path: "b.ts", size: 4 })) as any =
      (async () => makeJsonResponse({ deleted: true })) as any;

  const ctx = makeContext();
  await fileRenameHandler({ old_path: "a.ts", new_path: "b.ts" }, ctx);

  assertSpyCallArgs(mockRequireContainer, 0, [ctx]);
});
// ---------------------------------------------------------------------------
// file_copy handler
// ---------------------------------------------------------------------------

Deno.test("fileCopyHandler - copies a text file successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({
        content: "source content",
        is_binary: false,
      })) as any =
      (async () => makeJsonResponse({ path: "dest.ts", size: 14 })) as any;

  const result = await fileCopyHandler(
    { source_path: "src.ts", dest_path: "dest.ts" },
    makeContext(),
  );

  assertEquals(result, "Copied: src.ts -> dest.ts");
});
Deno.test("fileCopyHandler - throws when source file not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ error: "not found" }, 404)) as any;

  await assertRejects(async () => {
    await fileCopyHandler(
      { source_path: "missing.ts", dest_path: "dest.ts" },
      makeContext(),
    );
  }, "Source file not found: missing.ts");
});
Deno.test("fileCopyHandler - throws when write to destination fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () => makeJsonResponse({ content: "data" })) as any =
      (async () => makeJsonResponse({ error: "disk full" }, 507)) as any;

  await assertRejects(async () => {
    await fileCopyHandler(
      { source_path: "src.ts", dest_path: "dest.ts" },
      makeContext(),
    );
  }, "disk full");
});
Deno.test("fileCopyHandler - copies a binary file using binary write endpoint", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  const base64Content = btoa("binary content");
  mockBuildSessionPath = (_mount: string, path: string) => path as any;

  mockCallSessionApi =
    (async () =>
      makeJsonResponse({
        content: base64Content,
        is_binary: true,
        encoding: "base64",
      })) as any =
      (async () => makeJsonResponse({ path: "dest.png", size: 14 })) as any;

  const result = await fileCopyHandler(
    { source_path: "src.png", dest_path: "dest.png" },
    makeContext(),
  );

  assertEquals(result, "Copied: src.png -> dest.png");
  assertSpyCallArgs(mockCallSessionApi, 0, [
    expect.anything(),
    "/session/file/write-binary",
    { content_base64: base64Content },
  ]);
});
Deno.test("fileCopyHandler - writes to R2 backup", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "data", is_binary: false })) as any =
      (async () => makeJsonResponse({ path: "dest.ts", size: 4 })) as any;

  const ctx = makeContext();
  await fileCopyHandler(
    { source_path: "src.ts", dest_path: "dest.ts" },
    ctx,
  );

  assert(ctx.storage!.put.calls.length > 0);
});
Deno.test("fileCopyHandler - calls requireContainer to verify session", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "data", is_binary: false })) as any =
      (async () => makeJsonResponse({ path: "b.ts", size: 4 })) as any;

  const ctx = makeContext();
  await fileCopyHandler(
    { source_path: "a.ts", dest_path: "b.ts" },
    ctx,
  );

  assertSpyCallArgs(mockRequireContainer, 0, [ctx]);
});
Deno.test("fileCopyHandler - handles R2 backup write failure gracefully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockResolveMountPath = (async () => "") as any;
  mockBuildSessionPath = (_mount: string, path: string) => path as any;
  mockRequireContainer = (() => undefined) as any;
  mockCallSessionApi =
    (async () =>
      makeJsonResponse({ content: "data", is_binary: false })) as any =
      (async () => makeJsonResponse({ path: "dest.ts", size: 4 })) as any;

  const ctx = makeContext();
  (ctx.storage!.put as any) = (async () => {
    throw new Error("R2 error");
  }) as any;

  // Should succeed despite R2 failure
  const result = await fileCopyHandler(
    { source_path: "src.ts", dest_path: "dest.ts" },
    ctx,
  );

  assertEquals(result, "Copied: src.ts -> dest.ts");
});
