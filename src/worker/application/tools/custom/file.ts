import type { ToolHandler } from "../tool-definitions.ts";
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
  FILE_TOOLS,
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

export const FILE_HANDLERS: Record<string, ToolHandler> = {
  file_read: fileReadHandler,
  file_write: fileWriteHandler,
  file_write_binary: fileWriteBinaryHandler,
  file_list: fileListHandler,
  file_delete: fileDeleteHandler,
  file_mkdir: fileMkdirHandler,
  file_rename: fileRenameHandler,
  file_copy: fileCopyHandler,
};
