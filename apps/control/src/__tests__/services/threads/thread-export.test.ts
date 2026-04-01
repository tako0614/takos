import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import { exportThread, threadExportDeps } from "@/services/threads/thread-export";
import type { D1Database } from "@cloudflare/workers-types";

type MockDb = D1Database;

threadExportDeps.getDb = ((db) => mocks.getDb(db)) as typeof threadExportDeps.getDb;
threadExportDeps.logError = ((...args) => mocks.logError(...args)) as typeof threadExportDeps.logError;

function makeThreadRow(overrides: Partial<{
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? "thread-1",
    title: overrides.title !== undefined ? overrides.title : "Test Thread",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T01:00:00.000Z",
  };
}

function makeMessageRow(overrides: Partial<{
  role: string;
  content: string;
  sequence: number;
  createdAt: string;
}> = {}) {
  return {
    role: overrides.role ?? "user",
    content: overrides.content ?? "Hello world",
    sequence: overrides.sequence ?? 0,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:01.000Z",
  };
}

function buildDrizzleMock(options: {
  threadGet?: unknown;
  messagesAll?: unknown[];
}) {
  let selectIdx = 0;
  return {
    select: () => {
      selectIdx++;
      if (selectIdx === 1) {
        // thread lookup
        return {
          from: () => ({
            where: () => ({
              get: async () => options.threadGet,
            }),
          }),
        };
      }
      // messages lookup
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              all: async () => options.messagesAll ?? [],
            }),
          }),
        }),
      };
    },
  };
}

Deno.test("exportThread - returns null when thread is not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock({ threadGet: undefined })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "missing-thread",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  assertEquals(result, null);
});
Deno.test("exportThread - returns null when thread is deleted", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() =>
    buildDrizzleMock({
      threadGet: makeThreadRow({ status: "deleted" }),
    })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  assertEquals(result, null);
});
Deno.test("exportThread - exports thread as JSON with correct headers", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  const msgs = [
    makeMessageRow({ role: "user", content: "Hi", sequence: 0 }),
    makeMessageRow({ role: "assistant", content: "Hello!", sequence: 1 }),
  ];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  assertNotEquals(result, null);
  assertEquals(result!.status, 200);
  assertEquals(
    result!.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
  assertStringIncludes(
    result!.headers.get("Content-Disposition") ?? "",
    ".json",
  );
  assertEquals(result!.headers.get("Cache-Control"), "no-store");

  const body = await result!.json() as {
    thread: { id: string };
    messages: unknown[];
  };
  assertEquals(body.thread.id, "thread-1");
  assertEquals(body.messages.length, 2);
});
Deno.test("exportThread - filters internal roles (system, tool) when includeInternal is false", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  const msgs = [
    makeMessageRow({ role: "user", content: "Hello", sequence: 0 }),
    makeMessageRow({ role: "system", content: "Internal prompt", sequence: 1 }),
    makeMessageRow({ role: "assistant", content: "Reply", sequence: 2 }),
    makeMessageRow({ role: "tool", content: '{"result": 42}', sequence: 3 }),
  ];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  const body = await result!.json() as { messages: Array<{ role: string }> };
  assertEquals(body.messages.length, 2);
  assertEquals(body.messages.map((m) => m.role), ["user", "assistant"]);
});
Deno.test("exportThread - includes all roles when includeInternal and includeInternalRolesAllowed are both true", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  const msgs = [
    makeMessageRow({ role: "user", content: "Hello", sequence: 0 }),
    makeMessageRow({ role: "system", content: "System prompt", sequence: 1 }),
    makeMessageRow({ role: "tool", content: "tool result", sequence: 2 }),
    makeMessageRow({ role: "assistant", content: "Reply", sequence: 3 }),
  ];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: true,
    includeInternalRolesAllowed: true,
    format: "json",
  });

  const body = await result!.json() as { messages: Array<{ role: string }> };
  assertEquals(body.messages.length, 4);
});
Deno.test("exportThread - does not include internal roles when only includeInternal is true but includeInternalRolesAllowed is false", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  const msgs = [
    makeMessageRow({ role: "user", content: "Hello", sequence: 0 }),
    makeMessageRow({ role: "system", content: "System prompt", sequence: 1 }),
  ];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: true,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  const body = await result!.json() as { messages: Array<{ role: string }> };
  assertEquals(body.messages.length, 1);
  assertEquals(body.messages[0].role, "user");
});
Deno.test("exportThread - exports thread as markdown format", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow({ title: "My Thread" });
  const msgs = [
    makeMessageRow({ role: "user", content: "Hey there", sequence: 0 }),
  ];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "markdown",
  });

  assertEquals(result!.status, 200);
  assertEquals(
    result!.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assertStringIncludes(result!.headers.get("Content-Disposition") ?? "", ".md");

  const body = await result!.text();
  assertStringIncludes(body, "# My Thread");
  assertStringIncludes(body, "## Messages");
  assertStringIncludes(body, "Hey there");
});
Deno.test('exportThread - exports thread as markdown when format is "md"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  const msgs = [makeMessageRow()];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "md",
  });

  assertEquals(result!.status, 200);
  assertEquals(
    result!.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
});
Deno.test("exportThread - returns 503 when PDF format requested without renderPdf", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "pdf",
  });

  assertEquals(result!.status, 503);
  const body = await result!.json() as { error: string };
  assertStringIncludes(
    body.error ?? "",
    "PDF export requires Browser rendering",
  );
});
Deno.test("exportThread - exports thread as PDF when renderPdf is provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow({ title: "PDF Test" });
  const msgs = [makeMessageRow({ content: "PDF content" })];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const pdfBuffer = new ArrayBuffer(8);
  const renderCalls: string[] = [];
  const mockRenderPdf = async (html: string) => {
    renderCalls.push(html);
    return pdfBuffer;
  };

  const result = await exportThread({
    db: {} as MockDb,
    renderPdf: mockRenderPdf,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "pdf",
  });

  assertEquals(result!.status, 200);
  assertEquals(result!.headers.get("Content-Type"), "application/pdf");
  assertStringIncludes(
    result!.headers.get("Content-Disposition") ?? "",
    ".pdf",
  );

  // Verify the HTML passed to renderPdf contains the title
  const htmlArg = renderCalls[0];
  assertStringIncludes(htmlArg, "PDF Test");
  assertStringIncludes(htmlArg, "PDF content");
});
Deno.test("exportThread - returns 500 when renderPdf throws a generic error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const mockRenderPdf = async () => {
    throw new Error("render crash");
  };

  const result = await exportThread({
    db: {} as MockDb,
    renderPdf: mockRenderPdf,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "pdf",
  });

  assertEquals(result!.status, 500);
  const body = await result!.json() as { error: string };
  assertEquals(body.error, "Failed to generate PDF");
});
Deno.test('exportThread - returns 501 when renderPdf throws a "not supported" error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const mockRenderPdf = async () => {
    throw new Error("PDF rendering not supported");
  };

  const result = await exportThread({
    db: {} as MockDb,
    renderPdf: mockRenderPdf,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "pdf",
  });

  assertEquals(result!.status, 501);
});
Deno.test("exportThread - returns 400 for an unsupported format", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow();
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "xml",
  });

  assertEquals(result!.status, 400);
  const body = await result!.json() as { error: string };
  assertStringIncludes(body.error ?? "", "Invalid format");
});
Deno.test("exportThread - sanitizes thread title for filename", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow({
    title: "My Thread!@#$%^& with special chars",
  });
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  const disposition = result!.headers.get("Content-Disposition") ?? "";
  // Should not contain special chars except - and _
  assert(/filename="[A-Za-z0-9_-]+-thread-1\.json"/.test(disposition));
});
Deno.test('exportThread - defaults to "thread" when title is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow({ title: null });
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: [] })) as any;

  const result = await exportThread({
    db: {} as MockDb,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "json",
  });

  const disposition = result!.headers.get("Content-Disposition") ?? "";
  assertStringIncludes(disposition, "thread-thread-1.json");
});
Deno.test("exportThread - escapes HTML in PDF export to prevent XSS", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const thread = makeThreadRow({ title: '<script>alert("xss")</script>' });
  const msgs = [makeMessageRow({ content: '<img onerror="evil()">' })];
  mocks.getDb =
    (() => buildDrizzleMock({ threadGet: thread, messagesAll: msgs })) as any;

  const renderCalls: string[] = [];
  const mockRenderPdf = async (html: string) => {
    renderCalls.push(html);
    return new ArrayBuffer(8);
  };

  await exportThread({
    db: {} as MockDb,
    renderPdf: mockRenderPdf,
    threadId: "thread-1",
    includeInternal: false,
    includeInternalRolesAllowed: false,
    format: "pdf",
  });

  const htmlArg = renderCalls[0];
  assert(!htmlArg.includes("<script>"));
  assertStringIncludes(htmlArg, "&lt;script&gt;");
  assert(!htmlArg.includes("<img onerror"));
  assertStringIncludes(htmlArg, "&lt;img onerror");
});
