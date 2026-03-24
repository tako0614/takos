import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/source/workspace-storage', () => ({
  listStorageFiles: vi.fn(),
  readFileContent: vi.fn(),
  getStorageItemByPath: vi.fn(),
  createFolder: vi.fn(),
  deleteStorageItem: vi.fn(),
  deleteR2Objects: vi.fn(),
  renameStorageItem: vi.fn(),
  moveStorageItem: vi.fn(),
  writeFileContent: vi.fn(),
  createFileWithContent: vi.fn(),
}));

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
} from '@/services/source/workspace-storage';
import type { StorageFileResponse } from '@/services/source/workspace-storage';

import {
  WORKSPACE_FILES_LIST,
  WORKSPACE_FILES_READ,
  WORKSPACE_FILES_WRITE,
  WORKSPACE_FILES_CREATE,
  WORKSPACE_FILES_MKDIR,
  WORKSPACE_FILES_DELETE,
  WORKSPACE_FILES_RENAME,
  WORKSPACE_FILES_MOVE,
  WORKSPACE_FILES_TOOLS,
  WORKSPACE_FILES_HANDLERS,
  workspaceFilesListHandler,
  workspaceFilesReadHandler,
  workspaceFilesWriteHandler,
  workspaceFilesCreateHandler,
  workspaceFilesMkdirHandler,
  workspaceFilesDeleteHandler,
  workspaceFilesRenameHandler,
  workspaceFilesMoveHandler,
} from '@/tools/builtin/workspace-files';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

function makeStorageFile(
  overrides: Partial<StorageFileResponse> & Pick<StorageFileResponse, 'id' | 'name' | 'type' | 'size' | 'path'>,
): StorageFileResponse {
  return {
    id: overrides.id,
    space_id: overrides.space_id ?? 'ws-test',
    parent_id: overrides.parent_id ?? null,
    name: overrides.name,
    path: overrides.path,
    type: overrides.type,
    size: overrides.size,
    mime_type: overrides.mime_type ?? null,
    sha256: overrides.sha256 ?? null,
    uploaded_by: overrides.uploaded_by ?? null,
    created_at: overrides.created_at ?? '2026-03-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('workspace files tool definitions', () => {
  it('defines all eight tools', () => {
    expect(WORKSPACE_FILES_TOOLS).toHaveLength(8);
    const names = WORKSPACE_FILES_TOOLS.map((t) => t.name);
    expect(names).toContain('workspace_files_list');
    expect(names).toContain('workspace_files_read');
    expect(names).toContain('workspace_files_write');
    expect(names).toContain('workspace_files_create');
    expect(names).toContain('workspace_files_mkdir');
    expect(names).toContain('workspace_files_delete');
    expect(names).toContain('workspace_files_rename');
    expect(names).toContain('workspace_files_move');
  });

  it('all tools have file category', () => {
    for (const def of WORKSPACE_FILES_TOOLS) {
      expect(def.category).toBe('file');
    }
  });

  it('WORKSPACE_FILES_HANDLERS maps all tools', () => {
    for (const def of WORKSPACE_FILES_TOOLS) {
      expect(WORKSPACE_FILES_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('workspace_files_write requires content', () => {
    expect(WORKSPACE_FILES_WRITE.parameters.required).toEqual(['content']);
  });

  it('workspace_files_create requires path and content', () => {
    expect(WORKSPACE_FILES_CREATE.parameters.required).toEqual(['path', 'content']);
  });

  it('workspace_files_mkdir requires path', () => {
    expect(WORKSPACE_FILES_MKDIR.parameters.required).toEqual(['path']);
  });

  it('workspace_files_rename requires new_name', () => {
    expect(WORKSPACE_FILES_RENAME.parameters.required).toEqual(['new_name']);
  });

  it('workspace_files_move requires parent_path', () => {
    expect(WORKSPACE_FILES_MOVE.parameters.required).toEqual(['parent_path']);
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesListHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted file list', async () => {
    vi.mocked(listStorageFiles).mockResolvedValue({
      files: [
        makeStorageFile({ id: 'f1', name: 'readme.md', type: 'file', size: 1024, path: '/readme.md' }),
        makeStorageFile({ id: 'f2', name: 'docs', type: 'folder', size: 0, path: '/docs' }),
      ],
      truncated: false,
    });

    const result = await workspaceFilesListHandler({}, makeContext());

    expect(result).toContain('readme.md');
    expect(result).toContain('docs');
    expect(result).toContain('[id: f1]');
    expect(result).toContain('[id: f2]');
  });

  it('reports no files found', async () => {
    vi.mocked(listStorageFiles).mockResolvedValue({ files: [], truncated: false });

    const result = await workspaceFilesListHandler({}, makeContext());
    expect(result).toContain('No files found');
  });

  it('shows truncation note', async () => {
    vi.mocked(listStorageFiles).mockResolvedValue({
      files: [makeStorageFile({ id: 'f1', name: 'a.txt', type: 'file', size: 10, path: '/a.txt' })],
      truncated: true,
    });

    const result = await workspaceFilesListHandler({}, makeContext());
    expect(result).toContain('truncated');
  });

  it('formats file sizes correctly', async () => {
    vi.mocked(listStorageFiles).mockResolvedValue({
      files: [
        makeStorageFile({ id: 'f1', name: 'small.txt', type: 'file', size: 100, path: '/small.txt' }),
        makeStorageFile({ id: 'f2', name: 'medium.txt', type: 'file', size: 2048, path: '/medium.txt' }),
        makeStorageFile({ id: 'f3', name: 'large.txt', type: 'file', size: 2 * 1024 * 1024, path: '/large.txt' }),
      ],
      truncated: false,
    });

    const result = await workspaceFilesListHandler({}, makeContext());
    expect(result).toContain('100 B');
    expect(result).toContain('KB');
    expect(result).toContain('MB');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesReadHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesReadHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither file_id nor path is provided', async () => {
    await expect(
      workspaceFilesReadHandler({}, makeContext()),
    ).rejects.toThrow('Either file_id or path is required');
  });

  it('throws when storage not available', async () => {
    const ctx = makeContext({ env: {} as unknown as Env });
    await expect(
      workspaceFilesReadHandler({ file_id: 'f1' }, ctx),
    ).rejects.toThrow('Storage not available');
  });

  it('reads a text file by file_id', async () => {
    vi.mocked(readFileContent).mockResolvedValue({
      file: makeStorageFile({ id: 'f1', name: 'readme.md', path: '/readme.md', type: 'file', size: 100, mime_type: 'text/plain' }),
      content: '# Hello World',
      encoding: 'utf-8',
    });

    const result = await workspaceFilesReadHandler({ file_id: 'f1' }, makeContext());
    expect(result).toContain('readme.md');
    expect(result).toContain('# Hello World');
  });

  it('reads a file by path', async () => {
    vi.mocked(getStorageItemByPath).mockResolvedValue(
      makeStorageFile({ id: 'f1', type: 'file', name: 'readme.md', path: '/readme.md', size: 100 }),
    );
    vi.mocked(readFileContent).mockResolvedValue({
      file: makeStorageFile({ id: 'f1', name: 'readme.md', path: '/readme.md', type: 'file', size: 100, mime_type: 'text/plain' }),
      content: 'Content here',
      encoding: 'utf-8',
    });

    const result = await workspaceFilesReadHandler({ path: '/readme.md' }, makeContext());
    expect(result).toContain('Content here');
  });

  it('throws when path points to a folder', async () => {
    vi.mocked(getStorageItemByPath).mockResolvedValue(
      makeStorageFile({ id: 'f1', type: 'folder', name: 'docs', path: '/docs', size: 0 }),
    );

    await expect(
      workspaceFilesReadHandler({ path: '/docs' }, makeContext()),
    ).rejects.toThrow('is a folder');
  });

  it('returns base64 preview for binary files', async () => {
    vi.mocked(readFileContent).mockResolvedValue({
      file: makeStorageFile({ id: 'f1', name: 'image.png', path: '/image.png', type: 'file', size: 5000, mime_type: 'image/png' }),
      content: 'iVBORw0KGgo=...',
      encoding: 'base64',
    });

    const result = await workspaceFilesReadHandler({ file_id: 'f1' }, makeContext());
    expect(result).toContain('Binary file');
    expect(result).toContain('image.png');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesWriteHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesWriteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when content is not a string', async () => {
    await expect(
      workspaceFilesWriteHandler({ file_id: 'f1', content: 123 }, makeContext()),
    ).rejects.toThrow('content must be a string');
  });

  it('throws when storage not available', async () => {
    const ctx = makeContext({ env: {} as unknown as Env });
    await expect(
      workspaceFilesWriteHandler({ file_id: 'f1', content: 'test' }, ctx),
    ).rejects.toThrow('Storage not available');
  });

  it('writes file and returns JSON result', async () => {
    vi.mocked(writeFileContent).mockResolvedValue(
      makeStorageFile({ id: 'f1', name: 'test.md', type: 'file', path: '/test.md', size: 11 }),
    );

    const result = JSON.parse(
      await workspaceFilesWriteHandler(
        { file_id: 'f1', content: 'new content' },
        makeContext(),
      ),
    );

    expect(result.file.name).toBe('test.md');
  });

  it('throws when neither file_id nor path is provided', async () => {
    await expect(
      workspaceFilesWriteHandler({ content: 'test' }, makeContext()),
    ).rejects.toThrow('Either file_id or path is required');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesCreateHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesCreateHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when path is empty', async () => {
    await expect(
      workspaceFilesCreateHandler({ path: '', content: 'test' }, makeContext()),
    ).rejects.toThrow('path is required');
  });

  it('throws when content is not a string', async () => {
    await expect(
      workspaceFilesCreateHandler({ path: '/test.md', content: 123 }, makeContext()),
    ).rejects.toThrow('content must be a string');
  });

  it('creates a file and returns JSON result', async () => {
    vi.mocked(createFileWithContent).mockResolvedValue(
      makeStorageFile({ id: 'f-new', name: 'plan.md', type: 'file', path: '/docs/plan.md', size: 6 }),
    );

    const result = JSON.parse(
      await workspaceFilesCreateHandler(
        { path: '/docs/plan.md', content: '# Plan' },
        makeContext(),
      ),
    );

    expect(result.file.name).toBe('plan.md');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesMkdirHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesMkdirHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when path is empty', async () => {
    await expect(
      workspaceFilesMkdirHandler({ path: '' }, makeContext()),
    ).rejects.toThrow('path is required');
  });

  it('creates a folder', async () => {
    vi.mocked(createFolder).mockResolvedValue(
      makeStorageFile({ id: 'dir-1', name: 'specs', type: 'folder', path: '/docs/specs', size: 0 }),
    );

    const result = JSON.parse(
      await workspaceFilesMkdirHandler({ path: '/docs/specs' }, makeContext()),
    );
    expect(result.folder.name).toBe('specs');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesDeleteHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesDeleteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes an item and returns success', async () => {
    vi.mocked(deleteStorageItem).mockResolvedValue(['key1', 'key2']);
    vi.mocked(deleteR2Objects).mockResolvedValue(undefined);

    const result = JSON.parse(
      await workspaceFilesDeleteHandler({ file_id: 'f1' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.deleted_object_count).toBe(2);
  });

  it('handles R2 deletion failure gracefully', async () => {
    vi.mocked(deleteStorageItem).mockResolvedValue(['key1']);
    vi.mocked(deleteR2Objects).mockRejectedValue(new Error('R2 error'));

    const result = JSON.parse(
      await workspaceFilesDeleteHandler({ file_id: 'f1' }, makeContext()),
    );

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesRenameHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesRenameHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when new_name is empty', async () => {
    await expect(
      workspaceFilesRenameHandler({ file_id: 'f1', new_name: '' }, makeContext()),
    ).rejects.toThrow('new_name is required');
  });

  it('renames an item', async () => {
    vi.mocked(renameStorageItem).mockResolvedValue(
      makeStorageFile({ id: 'f1', name: 'new-name.md', type: 'file', path: '/new-name.md', size: 10 }),
    );

    const result = JSON.parse(
      await workspaceFilesRenameHandler(
        { file_id: 'f1', new_name: 'new-name.md' },
        makeContext(),
      ),
    );

    expect(result.file.name).toBe('new-name.md');
  });
});

// ---------------------------------------------------------------------------
// workspaceFilesMoveHandler
// ---------------------------------------------------------------------------

describe('workspaceFilesMoveHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when parent_path is empty', async () => {
    await expect(
      workspaceFilesMoveHandler({ file_id: 'f1', parent_path: '' }, makeContext()),
    ).rejects.toThrow('parent_path is required');
  });

  it('moves an item', async () => {
    vi.mocked(moveStorageItem).mockResolvedValue(
      makeStorageFile({ id: 'f1', name: 'file.md', type: 'file', path: '/new-dir/file.md', size: 7 }),
    );

    const result = JSON.parse(
      await workspaceFilesMoveHandler(
        { file_id: 'f1', parent_path: '/new-dir' },
        makeContext(),
      ),
    );

    expect(result.file.path).toBe('/new-dir/file.md');
  });
});
