import type { ToolDefinition, ToolHandler } from '../tool-definitions';
import {
  listStorageFiles,
  readFileContent,
  getStorageItemByPath,
  createFolder,
  deleteStorageItem,
  deleteR2Objects,
  renameStorageItem,
  moveStorageItem,
  writeFileContent,
  createFileWithContent,
} from '../../services/source/space-storage';

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function splitWorkspacePath(path: string): { name: string; parentPath: string } {
  const normalized = normalizeWorkspacePath(path).replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('path must not be the workspace root');
  }

  const name = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.length > 0 ? `/${parentSegments.join('/')}` : '/';

  return { name, parentPath };
}

async function resolveStorageItemId(args: Record<string, unknown>, context: Parameters<ToolHandler>[1]): Promise<string> {
  const fileId = typeof args.file_id === 'string' ? args.file_id.trim() : '';
  if (fileId) {
    return fileId;
  }

  const path = typeof args.path === 'string' ? normalizeWorkspacePath(args.path) : '';
  if (!path) {
    throw new Error('Either file_id or path is required');
  }

  const item = await getStorageItemByPath(context.db, context.spaceId, path);
  if (!item) {
    throw new Error(`File not found at path: ${path}`);
  }

  return item.id;
}

export const WORKSPACE_FILES_LIST: ToolDefinition = {
  name: 'workspace_files_list',
  description: 'List files and folders in the workspace storage. Workspace storage is a shared file store for the workspace (separate from the container filesystem). Use this to browse uploaded files, documents, and assets.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: "/" for root). Example: "/docs", "/images"',
      },
    },
  },
};

export const WORKSPACE_FILES_READ: ToolDefinition = {
  name: 'workspace_files_read',
  description: 'Read the content of a file from workspace storage. Returns text content for text files, or base64-encoded content for binary files. Supports reading by file ID or by path. Max file size: 50MB.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The file ID to read. Use this or path, not both.',
      },
      path: {
        type: 'string',
        description: 'The file path to read (e.g. "/docs/readme.md"). Use this or file_id, not both.',
      },
    },
  },
};

export const WORKSPACE_FILES_WRITE: ToolDefinition = {
  name: 'workspace_files_write',
  description: 'Replace the content of an existing workspace storage file.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The file ID to update. Use this or path, not both.',
      },
      path: {
        type: 'string',
        description: 'The file path to update. Use this or file_id, not both.',
      },
      content: {
        type: 'string',
        description: 'New file content',
      },
      mime_type: {
        type: 'string',
        description: 'Optional MIME type override',
      },
    },
    required: ['content'],
  },
};

export const WORKSPACE_FILES_CREATE: ToolDefinition = {
  name: 'workspace_files_create',
  description: 'Create a new workspace storage file with content.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to create, e.g. /docs/plan.md',
      },
      content: {
        type: 'string',
        description: 'File content',
      },
      mime_type: {
        type: 'string',
        description: 'Optional MIME type',
      },
    },
    required: ['path', 'content'],
  },
};

export const WORKSPACE_FILES_MKDIR: ToolDefinition = {
  name: 'workspace_files_mkdir',
  description: 'Create a workspace storage folder.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Folder path to create, e.g. /docs/specs',
      },
    },
    required: ['path'],
  },
};

export const WORKSPACE_FILES_DELETE: ToolDefinition = {
  name: 'workspace_files_delete',
  description: 'Delete a workspace storage file or folder by ID or path.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The file or folder ID to delete. Use this or path, not both.',
      },
      path: {
        type: 'string',
        description: 'The file or folder path to delete. Use this or file_id, not both.',
      },
    },
  },
};

export const WORKSPACE_FILES_RENAME: ToolDefinition = {
  name: 'workspace_files_rename',
  description: 'Rename a workspace storage file or folder.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The file or folder ID to rename. Use this or path, not both.',
      },
      path: {
        type: 'string',
        description: 'The file or folder path to rename. Use this or file_id, not both.',
      },
      new_name: {
        type: 'string',
        description: 'New base name',
      },
    },
    required: ['new_name'],
  },
};

export const WORKSPACE_FILES_MOVE: ToolDefinition = {
  name: 'workspace_files_move',
  description: 'Move a workspace storage file or folder into another folder.',
  category: 'file',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The file or folder ID to move. Use this or path, not both.',
      },
      path: {
        type: 'string',
        description: 'The file or folder path to move. Use this or file_id, not both.',
      },
      parent_path: {
        type: 'string',
        description: 'Destination folder path',
      },
    },
    required: ['parent_path'],
  },
};

export const workspaceFilesListHandler: ToolHandler = async (args, context) => {
  const path = (args.path as string) || '/';

  const result = await listStorageFiles(context.db, context.spaceId, path);

  if (result.files.length === 0) {
    return `No files found in "${path}"`;
  }

  const lines = result.files.map(f => {
    const icon = f.type === 'folder' ? '📁' : '📄';
    const sizeStr = f.type === 'file' ? ` (${formatSize(f.size)})` : '';
    return `${icon} ${f.name}${sizeStr}  [id: ${f.id}]`;
  });

  const truncatedNote = result.truncated ? `\n\n(Results truncated. More items exist in this folder.)` : '';
  return `Files in "${path}" (${result.files.length}):\n\n${lines.join('\n')}${truncatedNote}`;
};

export const workspaceFilesReadHandler: ToolHandler = async (args, context) => {
  const fileId = args.file_id as string | undefined;
  const path = args.path as string | undefined;

  if (!fileId && !path) {
    throw new Error('Either file_id or path is required');
  }

  const r2Bucket = context.env.GIT_OBJECTS;
  if (!r2Bucket) {
    throw new Error('Storage not available');
  }

  let resolvedFileId = fileId;
  if (!resolvedFileId && path) {
    const item = await getStorageItemByPath(context.db, context.spaceId, path);
    if (!item) throw new Error(`File not found at path: ${path}`);
    if (item.type === 'folder') throw new Error(`"${path}" is a folder, not a file`);
    resolvedFileId = item.id;
  }

  const result = await readFileContent(context.db, r2Bucket, context.spaceId, resolvedFileId!);

  if (result.encoding === 'base64') {
    return `Binary file: ${result.file.name} (${formatSize(result.file.size)}, ${result.file.mime_type || 'unknown type'})\n\n[base64 content, ${result.content.length} chars]\n${result.content.substring(0, 1000)}${result.content.length > 1000 ? '...' : ''}`;
  }

  return `File: ${result.file.name} (${result.file.path})\n\n${result.content}`;
};

export const workspaceFilesWriteHandler: ToolHandler = async (args, context) => {
  const content = args.content;
  if (typeof content !== 'string') {
    throw new Error('content must be a string');
  }

  const r2Bucket = context.env.GIT_OBJECTS;
  if (!r2Bucket) {
    throw new Error('Storage not available');
  }

  const fileId = await resolveStorageItemId(args, context);
  const file = await writeFileContent(
    context.db,
    r2Bucket,
    context.spaceId,
    fileId,
    content,
    context.userId,
    args.mime_type as string | undefined,
  );

  return JSON.stringify({ file }, null, 2);
};

export const workspaceFilesCreateHandler: ToolHandler = async (args, context) => {
  const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
  const path = rawPath ? normalizeWorkspacePath(rawPath) : '';
  const content = args.content;

  if (!path) {
    throw new Error('path is required');
  }
  if (typeof content !== 'string') {
    throw new Error('content must be a string');
  }

  const r2Bucket = context.env.GIT_OBJECTS;
  if (!r2Bucket) {
    throw new Error('Storage not available');
  }

  const file = await createFileWithContent(
    context.db,
    r2Bucket,
    context.spaceId,
    context.userId,
    path,
    content,
    args.mime_type as string | undefined,
  );

  return JSON.stringify({ file }, null, 2);
};

export const workspaceFilesMkdirHandler: ToolHandler = async (args, context) => {
  const path = typeof args.path === 'string' ? args.path : '';
  if (!path.trim()) {
    throw new Error('path is required');
  }

  const { name, parentPath } = splitWorkspacePath(path);
  const folder = await createFolder(context.db, context.spaceId, context.userId, {
    name,
    parentPath,
  });

  return JSON.stringify({ folder }, null, 2);
};

export const workspaceFilesDeleteHandler: ToolHandler = async (args, context) => {
  const itemId = await resolveStorageItemId(args, context);
  const r2Bucket = context.env.GIT_OBJECTS;
  if (!r2Bucket) {
    throw new Error('Storage not available');
  }

  const deletedKeys = await deleteStorageItem(context.db, context.spaceId, itemId);
  if (deletedKeys.length > 0) {
    try {
      await deleteR2Objects(r2Bucket, deletedKeys);
    } catch {
      // R2 deletion failure is non-fatal; DB records are already removed
    }
  }

  return JSON.stringify({
    success: true,
    file_id: itemId,
    deleted_object_count: deletedKeys.length,
  }, null, 2);
};

export const workspaceFilesRenameHandler: ToolHandler = async (args, context) => {
  const itemId = await resolveStorageItemId(args, context);
  const newName = typeof args.new_name === 'string' ? args.new_name.trim() : '';
  if (!newName) {
    throw new Error('new_name is required');
  }

  const file = await renameStorageItem(context.db, context.spaceId, itemId, { name: newName });
  return JSON.stringify({ file }, null, 2);
};

export const workspaceFilesMoveHandler: ToolHandler = async (args, context) => {
  const itemId = await resolveStorageItemId(args, context);
  const rawParentPath = typeof args.parent_path === 'string' ? args.parent_path.trim() : '';
  const parentPath = rawParentPath ? normalizeWorkspacePath(rawParentPath) : '';
  if (!parentPath) {
    throw new Error('parent_path is required');
  }

  const file = await moveStorageItem(context.db, context.spaceId, itemId, { parentPath });
  return JSON.stringify({ file }, null, 2);
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const WORKSPACE_FILES_TOOLS: ToolDefinition[] = [
  WORKSPACE_FILES_LIST,
  WORKSPACE_FILES_READ,
  WORKSPACE_FILES_WRITE,
  WORKSPACE_FILES_CREATE,
  WORKSPACE_FILES_MKDIR,
  WORKSPACE_FILES_DELETE,
  WORKSPACE_FILES_RENAME,
  WORKSPACE_FILES_MOVE,
];

export const WORKSPACE_FILES_HANDLERS: Record<string, ToolHandler> = {
  workspace_files_list: workspaceFilesListHandler,
  workspace_files_read: workspaceFilesReadHandler,
  workspace_files_write: workspaceFilesWriteHandler,
  workspace_files_create: workspaceFilesCreateHandler,
  workspace_files_mkdir: workspaceFilesMkdirHandler,
  workspace_files_delete: workspaceFilesDeleteHandler,
  workspace_files_rename: workspaceFilesRenameHandler,
  workspace_files_move: workspaceFilesMoveHandler,
};
