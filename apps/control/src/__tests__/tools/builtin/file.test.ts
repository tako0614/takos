import { assertEquals, assertRejects } from "jsr:@std/assert";

import {
  FILE_COPY,
  FILE_DELETE,
  FILE_HANDLERS,
  FILE_LIST,
  FILE_MKDIR,
  FILE_READ,
  FILE_RENAME,
  FILE_TOOLS,
  FILE_WRITE,
  FILE_WRITE_BINARY,
  fileWriteBinaryHandler,
} from "@/tools/builtin/file";
import { isBinaryFile } from "@/tools/builtin/file/limits";

Deno.test("file tools - exports all builtin file tools", () => {
  assertEquals(FILE_TOOLS.map((tool) => tool.name), [
    "file_read",
    "file_write",
    "file_write_binary",
    "file_list",
    "file_delete",
    "file_mkdir",
    "file_rename",
    "file_copy",
  ]);
  assertEquals(Object.keys(FILE_HANDLERS).sort(), [
    "file_copy",
    "file_delete",
    "file_list",
    "file_mkdir",
    "file_read",
    "file_rename",
    "file_write",
    "file_write_binary",
  ]);
});

Deno.test("file tools - required parameters are defined on the public tool schema", () => {
  assertEquals(FILE_READ.parameters.required, ["path"]);
  assertEquals(FILE_WRITE.parameters.required, ["path", "content"]);
  assertEquals(FILE_WRITE_BINARY.parameters.required, [
    "path",
    "content_base64",
  ]);
  assertEquals(FILE_LIST.parameters.required, []);
  assertEquals(FILE_DELETE.parameters.required, ["path"]);
  assertEquals(FILE_MKDIR.parameters.required, ["path"]);
  assertEquals(FILE_RENAME.parameters.required, ["old_path", "new_path"]);
  assertEquals(FILE_COPY.parameters.required, ["source_path", "dest_path"]);
});

Deno.test("file limits - binary extension detection works", () => {
  assertEquals(isBinaryFile("image.png"), true);
  assertEquals(isBinaryFile("notes.txt"), false);
});

Deno.test("fileWriteBinaryHandler - rejects invalid base64 before any runtime call", async () => {
  await assertRejects(
    async () => {
      await fileWriteBinaryHandler(
        { path: "bad.png", content_base64: "!!!invalid-base64!!!" } as never,
        {} as Parameters<typeof fileWriteBinaryHandler>[1],
      );
    },
    "Invalid base64 content",
  );
});
