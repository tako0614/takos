import type { ToolHandler } from '../tool-definitions';
import {
  FILE_READ,
  FILE_WRITE,
  FILE_WRITE_BINARY,
  FILE_LIST,
  FILE_DELETE,
  FILE_MKDIR,
  FILE_RENAME,
  FILE_COPY,
  FILE_TOOLS,
} from './file/definitions';
import { fileReadHandler, fileListHandler } from './file/read-handlers';
import {
  fileWriteHandler,
  fileWriteBinaryHandler,
  fileCopyHandler,
  fileMkdirHandler,
} from './file/write-handlers';
import { fileDeleteHandler, fileRenameHandler } from './file/manage-handlers';

export {
  FILE_READ,
  FILE_WRITE,
  FILE_WRITE_BINARY,
  FILE_LIST,
  FILE_DELETE,
  FILE_MKDIR,
  FILE_RENAME,
  FILE_COPY,
  FILE_TOOLS,
};

export {
  fileReadHandler,
  fileWriteHandler,
  fileWriteBinaryHandler,
  fileListHandler,
  fileDeleteHandler,
  fileMkdirHandler,
  fileRenameHandler,
  fileCopyHandler,
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
