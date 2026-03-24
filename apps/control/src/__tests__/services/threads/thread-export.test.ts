import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logError: mocks.logError,
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

import { exportThread } from '@/services/threads/thread-export';
import type { D1Database } from '@takos/cloudflare-compat';

type MockDb = D1Database;

function makeThreadRow(overrides: Partial<{
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? 'thread-1',
    title: overrides.title !== undefined ? overrides.title : 'Test Thread',
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-03-01T01:00:00.000Z',
  };
}

function makeMessageRow(overrides: Partial<{
  role: string;
  content: string;
  sequence: number;
  createdAt: string;
}> = {}) {
  return {
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'Hello world',
    sequence: overrides.sequence ?? 0,
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:01.000Z',
  };
}

function buildDrizzleMock(options: {
  threadGet?: unknown;
  messagesAll?: unknown[];
}) {
  let selectIdx = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectIdx++;
      if (selectIdx === 1) {
        // thread lookup
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue(options.threadGet),
            }),
          }),
        };
      }
      // messages lookup
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue(options.messagesAll ?? []),
            }),
          }),
        }),
      };
    }),
  };
}

describe('exportThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when thread is not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: undefined }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'missing-thread',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    expect(result).toBeNull();
  });

  it('returns null when thread is deleted', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({
      threadGet: makeThreadRow({ status: 'deleted' }),
    }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    expect(result).toBeNull();
  });

  it('exports thread as JSON with correct headers', async () => {
    const thread = makeThreadRow();
    const msgs = [
      makeMessageRow({ role: 'user', content: 'Hi', sequence: 0 }),
      makeMessageRow({ role: 'assistant', content: 'Hello!', sequence: 1 }),
    ];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe(200);
    expect(result!.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(result!.headers.get('Content-Disposition')).toContain('.json');
    expect(result!.headers.get('Cache-Control')).toBe('no-store');

    const body = await result!.json() as { thread: { id: string }; messages: unknown[] };
    expect(body.thread.id).toBe('thread-1');
    expect(body.messages).toHaveLength(2);
  });

  it('filters internal roles (system, tool) when includeInternal is false', async () => {
    const thread = makeThreadRow();
    const msgs = [
      makeMessageRow({ role: 'user', content: 'Hello', sequence: 0 }),
      makeMessageRow({ role: 'system', content: 'Internal prompt', sequence: 1 }),
      makeMessageRow({ role: 'assistant', content: 'Reply', sequence: 2 }),
      makeMessageRow({ role: 'tool', content: '{"result": 42}', sequence: 3 }),
    ];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    const body = await result!.json() as { messages: Array<{ role: string }> };
    expect(body.messages).toHaveLength(2);
    expect(body.messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('includes all roles when includeInternal and includeInternalRolesAllowed are both true', async () => {
    const thread = makeThreadRow();
    const msgs = [
      makeMessageRow({ role: 'user', content: 'Hello', sequence: 0 }),
      makeMessageRow({ role: 'system', content: 'System prompt', sequence: 1 }),
      makeMessageRow({ role: 'tool', content: 'tool result', sequence: 2 }),
      makeMessageRow({ role: 'assistant', content: 'Reply', sequence: 3 }),
    ];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: true,
      includeInternalRolesAllowed: true,
      format: 'json',
    });

    const body = await result!.json() as { messages: Array<{ role: string }> };
    expect(body.messages).toHaveLength(4);
  });

  it('does not include internal roles when only includeInternal is true but includeInternalRolesAllowed is false', async () => {
    const thread = makeThreadRow();
    const msgs = [
      makeMessageRow({ role: 'user', content: 'Hello', sequence: 0 }),
      makeMessageRow({ role: 'system', content: 'System prompt', sequence: 1 }),
    ];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: true,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    const body = await result!.json() as { messages: Array<{ role: string }> };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  it('exports thread as markdown format', async () => {
    const thread = makeThreadRow({ title: 'My Thread' });
    const msgs = [
      makeMessageRow({ role: 'user', content: 'Hey there', sequence: 0 }),
    ];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'markdown',
    });

    expect(result!.status).toBe(200);
    expect(result!.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(result!.headers.get('Content-Disposition')).toContain('.md');

    const body = await result!.text();
    expect(body).toContain('# My Thread');
    expect(body).toContain('## Messages');
    expect(body).toContain('Hey there');
  });

  it('exports thread as markdown when format is "md"', async () => {
    const thread = makeThreadRow();
    const msgs = [makeMessageRow()];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'md',
    });

    expect(result!.status).toBe(200);
    expect(result!.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('returns 503 when PDF format requested without renderPdf', async () => {
    const thread = makeThreadRow();
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'pdf',
    });

    expect(result!.status).toBe(503);
    const body = await result!.json() as { error: string };
    expect(body.error).toContain('PDF export requires Browser rendering');
  });

  it('exports thread as PDF when renderPdf is provided', async () => {
    const thread = makeThreadRow({ title: 'PDF Test' });
    const msgs = [makeMessageRow({ content: 'PDF content' })];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const pdfBuffer = new ArrayBuffer(8);
    const mockRenderPdf = vi.fn().mockResolvedValue(pdfBuffer);

    const result = await exportThread({
      db: {} as MockDb,
      renderPdf: mockRenderPdf,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'pdf',
    });

    expect(result!.status).toBe(200);
    expect(result!.headers.get('Content-Type')).toBe('application/pdf');
    expect(result!.headers.get('Content-Disposition')).toContain('.pdf');
    expect(mockRenderPdf).toHaveBeenCalledOnce();

    // Verify the HTML passed to renderPdf contains the title
    const htmlArg = mockRenderPdf.mock.calls[0][0] as string;
    expect(htmlArg).toContain('PDF Test');
    expect(htmlArg).toContain('PDF content');
  });

  it('returns 500 when renderPdf throws a generic error', async () => {
    const thread = makeThreadRow();
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const mockRenderPdf = vi.fn().mockRejectedValue(new Error('render crash'));

    const result = await exportThread({
      db: {} as MockDb,
      renderPdf: mockRenderPdf,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'pdf',
    });

    expect(result!.status).toBe(500);
    const body = await result!.json() as { error: string };
    expect(body.error).toBe('Failed to generate PDF');
  });

  it('returns 501 when renderPdf throws a "not supported" error', async () => {
    const thread = makeThreadRow();
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const mockRenderPdf = vi.fn().mockRejectedValue(new Error('PDF rendering not supported'));

    const result = await exportThread({
      db: {} as MockDb,
      renderPdf: mockRenderPdf,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'pdf',
    });

    expect(result!.status).toBe(501);
  });

  it('returns 400 for an unsupported format', async () => {
    const thread = makeThreadRow();
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'xml',
    });

    expect(result!.status).toBe(400);
    const body = await result!.json() as { error: string };
    expect(body.error).toContain('Invalid format');
  });

  it('sanitizes thread title for filename', async () => {
    const thread = makeThreadRow({ title: 'My Thread!@#$%^& with special chars' });
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    const disposition = result!.headers.get('Content-Disposition')!;
    // Should not contain special chars except - and _
    expect(disposition).toMatch(/filename="[A-Za-z0-9_-]+-thread-1\.json"/);
  });

  it('defaults to "thread" when title is null', async () => {
    const thread = makeThreadRow({ title: null });
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: [] }));

    const result = await exportThread({
      db: {} as MockDb,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'json',
    });

    const disposition = result!.headers.get('Content-Disposition')!;
    expect(disposition).toContain('thread-thread-1.json');
  });

  it('escapes HTML in PDF export to prevent XSS', async () => {
    const thread = makeThreadRow({ title: '<script>alert("xss")</script>' });
    const msgs = [makeMessageRow({ content: '<img onerror="evil()">' })];
    mocks.getDb.mockReturnValue(buildDrizzleMock({ threadGet: thread, messagesAll: msgs }));

    const mockRenderPdf = vi.fn().mockResolvedValue(new ArrayBuffer(8));

    await exportThread({
      db: {} as MockDb,
      renderPdf: mockRenderPdf,
      threadId: 'thread-1',
      includeInternal: false,
      includeInternalRolesAllowed: false,
      format: 'pdf',
    });

    const htmlArg = mockRenderPdf.mock.calls[0][0] as string;
    expect(htmlArg).not.toContain('<script>');
    expect(htmlArg).toContain('&lt;script&gt;');
    expect(htmlArg).not.toContain('<img onerror');
    expect(htmlArg).toContain('&lt;img onerror');
  });
});
