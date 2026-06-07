import { defineTools } from "./define-tools.ts";
import {
  FILE_COPY,
  FILE_DELETE,
  FILE_LIST,
  FILE_MKDIR,
  FILE_READ,
  FILE_RENAME,
  FILE_WRITE,
  FILE_WRITE_BINARY,
} from "./file/definitions.ts";
import { fileListHandler, fileReadHandler } from "./file/read-handlers.ts";
import {
  fileCopyHandler,
  fileMkdirHandler,
  fileWriteBinaryHandler,
  fileWriteHandler,
} from "./file/write-handlers.ts";
import {
  fileDeleteHandler,
  fileRenameHandler,
} from "./file/manage-handlers.ts";

export {
  FILE_COPY,
  FILE_DELETE,
  FILE_LIST,
  FILE_MKDIR,
  FILE_READ,
  FILE_RENAME,
  FILE_WRITE,
  FILE_WRITE_BINARY,
};

export {
  fileCopyHandler,
  fileDeleteHandler,
  fileListHandler,
  fileMkdirHandler,
  fileReadHandler,
  fileRenameHandler,
  fileWriteBinaryHandler,
  fileWriteHandler,
};

export const { tools: FILE_TOOLS, handlers: FILE_HANDLERS } = defineTools([
  [FILE_READ, fileReadHandler],
  [FILE_WRITE, fileWriteHandler],
  [FILE_WRITE_BINARY, fileWriteBinaryHandler],
  [FILE_LIST, fileListHandler],
  [FILE_DELETE, fileDeleteHandler],
  [FILE_MKDIR, fileMkdirHandler],
  [FILE_RENAME, fileRenameHandler],
  [FILE_COPY, fileCopyHandler],
]);
