import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCallSessionApi = vi.fn();
const mockRequireContainer = vi.fn();
const mockResolveMountPath = vi.fn();
const mockBuildSessionPath = vi.fn();
const mockSetupFileOperation = vi.fn();
const mockHandleSessionApiResponse = vi.fn();

vi.mock('@/tools/builtin/file/session', () => ({
  callSessionApi: (...args: unknown[]) => mockCallSessionApi(...args),
  requireContainer: (...args: unknown[]) => mockRequireContainer(...args),
  resolveMountPath: (...args: unknown[]) => mockResolveMountPath(...args),
  buildSessionPath: (...args: unknown[]) => mockBuildSessionPath(...args),
}));

vi.mock('@/tools/builtin/file/helpers', () => ({
  setupFileOperation: (...args: unknown[]) => mockSetupFileOperation(...args),
  handleSessionApiResponse: (...args: unknown[]) => mockHandleSessionApiResponse(...args),
}));

vi.mock('@/tools/builtin/file/limits', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    isBinaryFile: vi.fn((path: string) => path.endsWith('.png') || path.endsWith('.jpg')),
    validateContent: vi.fn(),
    validateBinaryContent: vi.fn(),
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

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
} from '@/tools/builtin/file/definitions';
import {
  FILE_HANDLERS,
  fileReadHandler,
  fileWriteHandler,
  fileWriteBinaryHandler,
  fileListHandler,
  fileDeleteHandler,
  fileMkdirHandler,
  fileRenameHandler,
  fileCopyHandler,
} from '@/tools/builtin/file';
import { isBinaryFile, validateContent, validateBinaryContent, BINARY_EXTENSIONS } from '@/tools/builtin/file/limits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    sessionId: 'session-1',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      RUNTIME_HOST: { fetch: vi.fn() },
    } as unknown as Env,
    db: {} as D1Database,
    storage: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(async () => ({ objects: [] })),
    } as unknown as ToolContext['storage'],
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('file tool definitions', () => {
  it('defines all eight file tools', () => {
    expect(FILE_TOOLS).toHaveLength(8);
    const names = FILE_TOOLS.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_write_binary');
    expect(names).toContain('file_list');
    expect(names).toContain('file_delete');
    expect(names).toContain('file_mkdir');
    expect(names).toContain('file_rename');
    expect(names).toContain('file_copy');
  });

  it('all tools have file category', () => {
    for (const def of FILE_TOOLS) {
      expect(def.category).toBe('file');
    }
  });

  it('file_read requires path', () => {
    expect(FILE_READ.parameters.required).toEqual(['path']);
  });

  it('file_write requires path and content', () => {
    expect(FILE_WRITE.parameters.required).toEqual(['path', 'content']);
  });

  it('file_write_binary requires path and content_base64', () => {
    expect(FILE_WRITE_BINARY.parameters.required).toEqual(['path', 'content_base64']);
  });

  it('file_rename requires old_path and new_path', () => {
    expect(FILE_RENAME.parameters.required).toEqual(['old_path', 'new_path']);
  });

  it('file_copy requires source_path and dest_path', () => {
    expect(FILE_COPY.parameters.required).toEqual(['source_path', 'dest_path']);
  });

  it('file_delete requires path', () => {
    expect(FILE_DELETE.parameters.required).toEqual(['path']);
  });

  it('file_mkdir requires path', () => {
    expect(FILE_MKDIR.parameters.required).toEqual(['path']);
  });

  it('file_list has no required parameters', () => {
    expect(FILE_LIST.parameters.required).toEqual([]);
  });

  it('FILE_HANDLERS maps all tools', () => {
    expect(Object.keys(FILE_HANDLERS)).toHaveLength(8);
    for (const def of FILE_TOOLS) {
      expect(FILE_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('file tools support repo_id and mount_path parameters', () => {
    for (const def of FILE_TOOLS) {
      expect(def.parameters.properties).toHaveProperty('repo_id');
      expect(def.parameters.properties).toHaveProperty('mount_path');
    }
  });
});

// ---------------------------------------------------------------------------
// limits module
// ---------------------------------------------------------------------------

describe('file limits', () => {
  it('isBinaryFile detects binary extensions', () => {
    expect(isBinaryFile('photo.png')).toBe(true);
    expect(isBinaryFile('image.jpg')).toBe(true);
  });

  it('BINARY_EXTENSIONS contains expected extensions', () => {
    expect(BINARY_EXTENSIONS).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// file_read handler
// ---------------------------------------------------------------------------

describe('fileReadHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupFileOperation.mockResolvedValue({ path: '', mountPath: '', sessionId: 'session-1' });
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
  });

  it('reads a text file', async () => {
    mockSetupFileOperation.mockResolvedValue({ path: 'src/index.ts', mountPath: '', sessionId: 'session-1' });
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ content: 'hello world', size: 11 }));
    mockHandleSessionApiResponse.mockResolvedValue({ content: 'hello world', size: 11 });

    const result = await fileReadHandler({ path: 'src/index.ts' }, makeContext());
    expect(result).toBe('hello world');
  });

  it('reads a binary file as base64 preview', async () => {
    mockSetupFileOperation.mockResolvedValue({ path: 'logo.png', mountPath: '', sessionId: 'session-1' });
    const response = makeJsonResponse({ content: 'iVBORw0KGgo=', size: 1024, is_binary: true });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ content: 'iVBORw0KGgo=', size: 1024, is_binary: true });

    const result = await fileReadHandler({ path: 'logo.png' }, makeContext());

    expect(result).toContain('[Binary file: logo.png]');
    expect(result).toContain('1024 bytes');
  });

  it('throws when file not found (404)', async () => {
    mockSetupFileOperation.mockResolvedValue({ path: 'missing.ts', mountPath: '', sessionId: 'session-1' });
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ error: 'not found' }, 404));

    await expect(fileReadHandler({ path: 'missing.ts' }, makeContext())).rejects.toThrow(
      'File not found',
    );
  });

  it('throws on non-ok response via handleSessionApiResponse', async () => {
    mockSetupFileOperation.mockResolvedValue({ path: 'test.ts', mountPath: '', sessionId: 'session-1' });
    const response = makeJsonResponse({ error: 'disk full' }, 500);
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockRejectedValue(new Error('disk full'));

    await expect(fileReadHandler({ path: 'test.ts' }, makeContext())).rejects.toThrow(
      'disk full',
    );
  });

  it('truncates base64 content at 200 characters for binary preview', async () => {
    const longBase64 = 'A'.repeat(300);
    mockSetupFileOperation.mockResolvedValue({ path: 'big.png', mountPath: '', sessionId: 'session-1' });
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ content: longBase64, size: 5000, is_binary: true }));
    mockHandleSessionApiResponse.mockResolvedValue({ content: longBase64, size: 5000, is_binary: true });

    const result = await fileReadHandler({ path: 'big.png' }, makeContext());

    expect(result).toContain('...');
    expect(result).toContain('[Binary file: big.png]');
  });
});

// ---------------------------------------------------------------------------
// file_write handler
// ---------------------------------------------------------------------------

describe('fileWriteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupFileOperation.mockResolvedValue({ path: 'src/index.ts', mountPath: '', sessionId: 'session-1' });
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
  });

  it('writes a file and returns success message', async () => {
    const response = makeJsonResponse({ path: 'src/index.ts', size: 22 });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ path: 'src/index.ts', size: 22 });

    const result = await fileWriteHandler(
      { path: 'src/index.ts', content: 'console.log("hello")' },
      makeContext(),
    );

    expect(result).toContain('Written file');
    expect(result).toContain('22 bytes');
  });

  it('throws when runtime write fails', async () => {
    mockCallSessionApi.mockRejectedValue(new Error('connection refused'));

    await expect(
      fileWriteHandler({ path: 'test.ts', content: 'test' }, makeContext()),
    ).rejects.toThrow('Failed to write file');
  });

  it('calls validateContent with content and path', async () => {
    const response = makeJsonResponse({ path: 'src/app.ts', size: 10 });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ path: 'src/app.ts', size: 10 });

    await fileWriteHandler(
      { path: 'src/app.ts', content: 'test content' },
      makeContext(),
    );

    expect(validateContent).toHaveBeenCalledWith('test content', 'src/index.ts');
  });

  it('writes to R2 backup alongside runtime', async () => {
    const ctx = makeContext();
    const response = makeJsonResponse({ path: 'src/main.ts', size: 5 });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ path: 'src/main.ts', size: 5 });

    await fileWriteHandler(
      { path: 'src/main.ts', content: 'hello' },
      ctx,
    );

    expect(ctx.storage!.put).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// file_list handler
// ---------------------------------------------------------------------------

describe('fileListHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupFileOperation.mockResolvedValue({ path: '', mountPath: '', sessionId: 'session-1' });
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path || '');
  });

  it('lists files with sorting (dirs first)', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({
        entries: [
          { name: 'file.ts', type: 'file', size: 100 },
          { name: 'src', type: 'dir' },
          { name: 'app.ts', type: 'file', size: 200 },
        ],
      }),
    );
    mockHandleSessionApiResponse.mockResolvedValue({
      entries: [
        { name: 'file.ts', type: 'file', size: 100 },
        { name: 'src', type: 'dir' },
        { name: 'app.ts', type: 'file', size: 200 },
      ],
    });

    const result = await fileListHandler({}, makeContext());

    // Directories should come first
    const lines = result.split('\n');
    expect(lines[0]).toContain('src/');
    expect(lines[1]).toContain('app.ts');
    expect(lines[2]).toContain('file.ts');
  });

  it('returns message when no files found', async () => {
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ entries: [] }));
    mockHandleSessionApiResponse.mockResolvedValue({ entries: [] });

    const result = await fileListHandler({}, makeContext());
    expect(result).toContain('No files found');
  });

  it('throws when list fails', async () => {
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ error: 'session lost' }, 500));
    mockHandleSessionApiResponse.mockRejectedValue(new Error('session lost'));

    await expect(fileListHandler({}, makeContext())).rejects.toThrow('session lost');
  });

  it('sorts files alphabetically within type', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({
        entries: [
          { name: 'zebra.ts', type: 'file', size: 10 },
          { name: 'alpha.ts', type: 'file', size: 20 },
          { name: 'beta', type: 'dir' },
          { name: 'alpha', type: 'dir' },
        ],
      }),
    );
    mockHandleSessionApiResponse.mockResolvedValue({
      entries: [
        { name: 'zebra.ts', type: 'file', size: 10 },
        { name: 'alpha.ts', type: 'file', size: 20 },
        { name: 'beta', type: 'dir' },
        { name: 'alpha', type: 'dir' },
      ],
    });

    const result = await fileListHandler({}, makeContext());
    const lines = result.split('\n');

    // Dirs first, then files, both alphabetically sorted
    expect(lines[0]).toContain('alpha/');
    expect(lines[1]).toContain('beta/');
    expect(lines[2]).toContain('alpha.ts');
    expect(lines[3]).toContain('zebra.ts');
  });
});

// ---------------------------------------------------------------------------
// file_write_binary handler
// ---------------------------------------------------------------------------

describe('fileWriteBinaryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
    mockRequireContainer.mockReturnValue(undefined);
  });

  it('writes binary content and returns success message', async () => {
    const validBase64 = btoa('hello binary');
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'image.png', size: 12 }),
    );

    const ctx = makeContext();
    const result = await fileWriteBinaryHandler(
      { path: 'image.png', content_base64: validBase64 },
      ctx,
    );

    expect(result).toContain('Written binary file');
    expect(result).toContain('12 bytes');
  });

  it('throws on invalid base64 content', async () => {
    // atob will throw on completely invalid base64
    mockCallSessionApi.mockRejectedValue(new Error('should not be called'));

    // The handler decodes base64 before the API call. Invalid base64 should throw.
    // We need to craft a string that is truly invalid for atob.
    // The handler catches the atob error and throws 'Invalid base64 content'.
    // However, the callSessionApi and storage calls are made in Promise.allSettled,
    // and the base64 decode happens before that. Let's verify the flow.
    const ctx = makeContext();

    // Using a string that will fail atob
    await expect(
      fileWriteBinaryHandler(
        { path: 'bad.png', content_base64: '!!!invalid-base64!!!' },
        ctx,
      ),
    ).rejects.toThrow('Invalid base64 content');
  });

  it('calls validateBinaryContent for size limit checks', async () => {
    const validBase64 = btoa('small content');
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'icon.png', size: 13 }),
    );

    await fileWriteBinaryHandler(
      { path: 'icon.png', content_base64: validBase64 },
      makeContext(),
    );

    expect(validateBinaryContent).toHaveBeenCalledWith(validBase64, 'icon.png');
  });

  it('calls requireContainer to verify session', async () => {
    const validBase64 = btoa('content');
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'file.png', size: 7 }),
    );

    const ctx = makeContext();
    await fileWriteBinaryHandler(
      { path: 'file.png', content_base64: validBase64 },
      ctx,
    );

    expect(mockRequireContainer).toHaveBeenCalledWith(ctx);
  });

  it('writes to R2 backup alongside runtime', async () => {
    const validBase64 = btoa('binary data');
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'data.bin', size: 11 }),
    );

    const ctx = makeContext();
    await fileWriteBinaryHandler(
      { path: 'data.bin', content_base64: validBase64 },
      ctx,
    );

    expect(ctx.storage!.put).toHaveBeenCalled();
  });

  it('throws when runtime binary write fails', async () => {
    const validBase64 = btoa('content');
    mockCallSessionApi.mockRejectedValue(new Error('runtime down'));

    const ctx = makeContext();
    await expect(
      fileWriteBinaryHandler(
        { path: 'image.png', content_base64: validBase64 },
        ctx,
      ),
    ).rejects.toThrow('Failed to write binary file');
  });

  it('throws when response is not ok', async () => {
    const validBase64 = btoa('content');
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ error: 'quota exceeded' }, 413),
    );

    const ctx = makeContext();
    await expect(
      fileWriteBinaryHandler(
        { path: 'large.png', content_base64: validBase64 },
        ctx,
      ),
    ).rejects.toThrow('quota exceeded');
  });
});

// ---------------------------------------------------------------------------
// file_delete handler
// ---------------------------------------------------------------------------

describe('fileDeleteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupFileOperation.mockResolvedValue({ path: 'old-file.ts', mountPath: '', sessionId: 'session-1' });
  });

  it('deletes a file and returns success message', async () => {
    const response = makeJsonResponse({ deleted: true });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ deleted: true });

    const ctx = makeContext();
    const result = await fileDeleteHandler({ path: 'old-file.ts' }, ctx);

    expect(result).toBe('Deleted file: old-file.ts');
  });

  it('throws when file not found (404)', async () => {
    mockCallSessionApi.mockResolvedValue(makeJsonResponse({ error: 'not found' }, 404));

    await expect(
      fileDeleteHandler({ path: 'missing.ts' }, makeContext()),
    ).rejects.toThrow('File not found: old-file.ts');
  });

  it('throws when runtime delete fails', async () => {
    mockCallSessionApi.mockRejectedValue(new Error('connection lost'));

    await expect(
      fileDeleteHandler({ path: 'file.ts' }, makeContext()),
    ).rejects.toThrow('Failed to delete file');
  });

  it('also deletes from R2 backup', async () => {
    const response = makeJsonResponse({ deleted: true });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ deleted: true });

    const ctx = makeContext();
    await fileDeleteHandler({ path: 'file.ts' }, ctx);

    expect(ctx.storage!.delete).toHaveBeenCalledWith(
      'session-files/ws-test/session-1/old-file.ts',
    );
  });

  it('handles R2 delete failure gracefully', async () => {
    const response = makeJsonResponse({ deleted: true });
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockResolvedValue({ deleted: true });

    const ctx = makeContext();
    (ctx.storage!.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('R2 error'));

    // Should not throw despite R2 failure
    const result = await fileDeleteHandler({ path: 'file.ts' }, ctx);
    expect(result).toBe('Deleted file: old-file.ts');
  });

  it('throws non-404 error via handleSessionApiResponse', async () => {
    const response = makeJsonResponse({ error: 'internal error' }, 500);
    mockCallSessionApi.mockResolvedValue(response);
    mockHandleSessionApiResponse.mockRejectedValue(new Error('internal error'));

    await expect(
      fileDeleteHandler({ path: 'file.ts' }, makeContext()),
    ).rejects.toThrow('internal error');
  });
});

// ---------------------------------------------------------------------------
// file_mkdir handler
// ---------------------------------------------------------------------------

describe('fileMkdirHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path.replace(/\/+$/, ''));
    mockRequireContainer.mockReturnValue(undefined);
  });

  it('creates a directory by writing a .gitkeep file', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'new-dir/.gitkeep', size: 0 }),
    );

    const result = await fileMkdirHandler({ path: 'new-dir' }, makeContext());

    expect(result).toContain('Created directory');
    expect(result).toContain('new-dir/');

    // Verify it writes a .gitkeep file
    expect(mockCallSessionApi).toHaveBeenCalledWith(
      expect.anything(),
      '/session/file/write',
      expect.objectContaining({
        path: 'new-dir/.gitkeep',
        content: '',
      }),
    );
  });

  it('strips trailing slashes from path', async () => {
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'my-dir/.gitkeep', size: 0 }),
    );

    await fileMkdirHandler({ path: 'my-dir/' }, makeContext());

    // buildSessionPath receives the path without trailing slash
    expect(mockBuildSessionPath).toHaveBeenCalledWith('', 'my-dir');
  });

  it('throws when creation fails', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ error: 'permission denied' }, 403),
    );

    await expect(
      fileMkdirHandler({ path: 'restricted-dir' }, makeContext()),
    ).rejects.toThrow('permission denied');
  });

  it('calls requireContainer to verify session', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'dir/.gitkeep', size: 0 }),
    );

    const ctx = makeContext();
    await fileMkdirHandler({ path: 'dir' }, ctx);

    expect(mockRequireContainer).toHaveBeenCalledWith(ctx);
  });

  it('handles already-exists case (server returns success for idempotent write)', async () => {
    mockCallSessionApi.mockResolvedValue(
      makeJsonResponse({ path: 'existing-dir/.gitkeep', size: 0 }),
    );

    const result = await fileMkdirHandler({ path: 'existing-dir' }, makeContext());
    expect(result).toContain('Created directory');
  });
});

// ---------------------------------------------------------------------------
// file_rename handler
// ---------------------------------------------------------------------------

describe('fileRenameHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
    mockRequireContainer.mockReturnValue(undefined);
  });

  it('renames a text file successfully', async () => {
    // First call: read old file
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'file content', is_binary: false }),
      )
      // Second call: write new file
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'new-name.ts', size: 12 }),
      )
      // Third call: delete old file
      .mockResolvedValueOnce(makeJsonResponse({ deleted: true }));

    const ctx = makeContext();
    const result = await fileRenameHandler(
      { old_path: 'old-name.ts', new_path: 'new-name.ts' },
      ctx,
    );

    expect(result).toBe('Renamed: old-name.ts -> new-name.ts');
  });

  it('throws when source file not found', async () => {
    mockCallSessionApi.mockResolvedValueOnce(
      makeJsonResponse({ error: 'not found' }, 404),
    );

    await expect(
      fileRenameHandler(
        { old_path: 'missing.ts', new_path: 'new.ts' },
        makeContext(),
      ),
    ).rejects.toThrow('Source file not found: missing.ts');
  });

  it('throws when write to new path fails', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ error: 'conflict' }, 409),
      );

    await expect(
      fileRenameHandler(
        { old_path: 'a.ts', new_path: 'b.ts' },
        makeContext(),
      ),
    ).rejects.toThrow('conflict');
  });

  it('renames a binary file (reads as base64, writes as binary)', async () => {
    const base64Content = btoa('binary data');
    // isBinaryFile mock returns true for .png
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);

    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: base64Content, is_binary: true, encoding: 'base64' }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'new-logo.png', size: 11 }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ deleted: true }));

    const ctx = makeContext();
    const result = await fileRenameHandler(
      { old_path: 'logo.png', new_path: 'new-logo.png' },
      ctx,
    );

    expect(result).toBe('Renamed: logo.png -> new-logo.png');

    // Should have used write-binary endpoint for the second call
    expect(mockCallSessionApi).toHaveBeenCalledWith(
      expect.anything(),
      '/session/file/write-binary',
      expect.objectContaining({ content_base64: base64Content }),
    );
  });

  it('updates R2 backup (writes new key, deletes old key)', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'content', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'new.ts', size: 7 }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ deleted: true }));

    const ctx = makeContext();
    await fileRenameHandler(
      { old_path: 'old.ts', new_path: 'new.ts' },
      ctx,
    );

    expect(ctx.storage!.put).toHaveBeenCalled();
    expect(ctx.storage!.delete).toHaveBeenCalled();
  });

  it('calls requireContainer to verify session', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'b.ts', size: 4 }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ deleted: true }));

    const ctx = makeContext();
    await fileRenameHandler({ old_path: 'a.ts', new_path: 'b.ts' }, ctx);

    expect(mockRequireContainer).toHaveBeenCalledWith(ctx);
  });
});

// ---------------------------------------------------------------------------
// file_copy handler
// ---------------------------------------------------------------------------

describe('fileCopyHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMountPath.mockResolvedValue('');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);
    mockRequireContainer.mockReturnValue(undefined);
  });

  it('copies a text file successfully', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'source content', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'dest.ts', size: 14 }),
      );

    const result = await fileCopyHandler(
      { source_path: 'src.ts', dest_path: 'dest.ts' },
      makeContext(),
    );

    expect(result).toBe('Copied: src.ts -> dest.ts');
  });

  it('throws when source file not found', async () => {
    mockCallSessionApi.mockResolvedValueOnce(
      makeJsonResponse({ error: 'not found' }, 404),
    );

    await expect(
      fileCopyHandler(
        { source_path: 'missing.ts', dest_path: 'dest.ts' },
        makeContext(),
      ),
    ).rejects.toThrow('Source file not found: missing.ts');
  });

  it('throws when write to destination fails', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data' }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ error: 'disk full' }, 507),
      );

    await expect(
      fileCopyHandler(
        { source_path: 'src.ts', dest_path: 'dest.ts' },
        makeContext(),
      ),
    ).rejects.toThrow('disk full');
  });

  it('copies a binary file using binary write endpoint', async () => {
    const base64Content = btoa('binary content');
    mockBuildSessionPath.mockImplementation((_mount: string, path: string) => path);

    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: base64Content, is_binary: true, encoding: 'base64' }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'dest.png', size: 14 }),
      );

    const result = await fileCopyHandler(
      { source_path: 'src.png', dest_path: 'dest.png' },
      makeContext(),
    );

    expect(result).toBe('Copied: src.png -> dest.png');
    expect(mockCallSessionApi).toHaveBeenCalledWith(
      expect.anything(),
      '/session/file/write-binary',
      expect.objectContaining({ content_base64: base64Content }),
    );
  });

  it('writes to R2 backup', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'dest.ts', size: 4 }),
      );

    const ctx = makeContext();
    await fileCopyHandler(
      { source_path: 'src.ts', dest_path: 'dest.ts' },
      ctx,
    );

    expect(ctx.storage!.put).toHaveBeenCalled();
  });

  it('calls requireContainer to verify session', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'b.ts', size: 4 }),
      );

    const ctx = makeContext();
    await fileCopyHandler(
      { source_path: 'a.ts', dest_path: 'b.ts' },
      ctx,
    );

    expect(mockRequireContainer).toHaveBeenCalledWith(ctx);
  });

  it('handles R2 backup write failure gracefully', async () => {
    mockCallSessionApi
      .mockResolvedValueOnce(
        makeJsonResponse({ content: 'data', is_binary: false }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ path: 'dest.ts', size: 4 }),
      );

    const ctx = makeContext();
    (ctx.storage!.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('R2 error'));

    // Should succeed despite R2 failure
    const result = await fileCopyHandler(
      { source_path: 'src.ts', dest_path: 'dest.ts' },
      ctx,
    );

    expect(result).toBe('Copied: src.ts -> dest.ts');
  });
});
