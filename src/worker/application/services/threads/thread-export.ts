import { getDb, messages, threads } from "../../../infra/db/index.ts";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import { readOffloadedMessageRecord } from "../offload/messages.ts";
import {
  AuthorizationError,
  BadRequestError,
  PayloadTooLargeError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import {
  MAX_DIRECT_THREAD_EXPORT_BODY_BYTES,
  MAX_DIRECT_THREAD_EXPORT_MESSAGES,
  MAX_DIRECT_THREAD_EXPORT_OFFLOAD_OBJECTS,
  THREAD_EXPORT_FORMATS,
  type ThreadExportFormat,
} from "../../../../contracts/public/thread-export.ts";
import { MAX_OFFLOADED_MESSAGE_CONTENT_BYTES } from "../offload/messages.ts";

const encoder = new TextEncoder();
const PUBLIC_EXPORT_ROLES = ["user", "assistant"] as const;
const INTERNAL_EXPORT_ROLES = ["user", "assistant", "system", "tool"] as const;

type ExportMessageRow = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  r2Key: string | null;
  sequence: number;
  createdAt: string;
};

export const threadExportDeps = {
  getDb,
  now: () => new Date().toISOString(),
};

function buildSafeFilenameComponent(value: string | null | undefined): string {
  return (
    (value || "thread")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "thread"
  );
}

function assistedExportError(reason: string): PayloadTooLargeError {
  return new PayloadTooLargeError(
    "This Thread export requires assisted processing",
    {
      assisted_processing: true,
      reason,
      max_messages: MAX_DIRECT_THREAD_EXPORT_MESSAGES,
      max_body_bytes: MAX_DIRECT_THREAD_EXPORT_BODY_BYTES,
    },
  );
}

function boundedTextBody(value: string): Uint8Array {
  const body = encoder.encode(value);
  if (body.byteLength > MAX_DIRECT_THREAD_EXPORT_BODY_BYTES) {
    throw assistedExportError("response_body_limit");
  }
  return body;
}

function attachmentHeaders(contentType: string, filename: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function assertCanonicalOffloadedMessage(
  row: ExportMessageRow,
  message: Awaited<ReturnType<typeof readOffloadedMessageRecord>>,
): asserts message is NonNullable<
  Awaited<ReturnType<typeof readOffloadedMessageRecord>>
> {
  if (
    !message ||
    message.message.id !== row.id ||
    message.message.thread_id !== row.threadId ||
    message.message.role !== row.role ||
    message.message.sequence !== row.sequence ||
    message.message.created_at !== row.createdAt
  ) {
    throw new ServiceUnavailableError(
      "Thread export message data is temporarily unavailable",
      { message_data_unavailable: true },
    );
  }
}

async function hydrateExportMessages(
  rows: ExportMessageRow[],
  offload: ObjectStoreBinding | undefined,
): Promise<ExportMessageRow[]> {
  const candidates = rows.filter((row) => Boolean(row.r2Key));
  if (candidates.length > MAX_DIRECT_THREAD_EXPORT_OFFLOAD_OBJECTS) {
    throw assistedExportError("offload_object_limit");
  }
  if (candidates.length > 0 && !offload) {
    throw new ServiceUnavailableError(
      "Thread export message storage is unavailable",
      { message_data_unavailable: true },
    );
  }

  let retainedObjectBytes = 0;
  let retainedContentBytes = 0;
  const hydrated: ExportMessageRow[] = [];
  for (const row of rows) {
    let content = row.content;
    if (row.r2Key) {
      const record = await readOffloadedMessageRecord(offload!, row.r2Key);
      assertCanonicalOffloadedMessage(row, record);
      retainedObjectBytes += record.size;
      if (retainedObjectBytes > MAX_DIRECT_THREAD_EXPORT_BODY_BYTES) {
        throw assistedExportError("offload_byte_limit");
      }
      content = record.message.content;
    }

    const contentBytes = encoder.encode(content).byteLength;
    if (contentBytes > MAX_OFFLOADED_MESSAGE_CONTENT_BYTES) {
      throw assistedExportError("message_content_limit");
    }
    retainedContentBytes += contentBytes;
    if (retainedContentBytes > MAX_DIRECT_THREAD_EXPORT_BODY_BYTES) {
      throw assistedExportError("message_content_total_limit");
    }
    hydrated.push({ ...row, content });
  }
  return hydrated;
}

export async function exportThread(params: {
  db: SqlDatabaseBinding;
  offload?: ObjectStoreBinding;
  threadId: string;
  includeInternal: boolean;
  includeInternalAuthorized: boolean;
  format: ThreadExportFormat;
}): Promise<Response | null> {
  if (!THREAD_EXPORT_FORMATS.includes(params.format)) {
    throw new BadRequestError("Invalid format. Supported: markdown, json");
  }
  if (params.includeInternal && !params.includeInternalAuthorized) {
    throw new AuthorizationError(
      "Only the Workspace owner may export internal messages",
    );
  }

  const db = threadExportDeps.getDb(params.db);
  const thread = await db
    .select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    })
    .from(threads)
    .where(eq(threads.id, params.threadId))
    .get();
  if (!thread || thread.status === "deleted") {
    return null;
  }

  const allowedRoles = params.includeInternal
    ? [...INTERNAL_EXPORT_ROLES]
    : [...PUBLIC_EXPORT_ROLES];
  const messageRows = await db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      role: messages.role,
      content: messages.content,
      r2Key: messages.r2Key,
      sequence: messages.sequence,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.threadId, params.threadId),
        inArray(messages.role, allowedRoles),
      ),
    )
    .orderBy(asc(messages.sequence))
    .limit(MAX_DIRECT_THREAD_EXPORT_MESSAGES + 1)
    .all();
  if (messageRows.length > MAX_DIRECT_THREAD_EXPORT_MESSAGES) {
    throw assistedExportError("message_count_limit");
  }
  const exportMessages = await hydrateExportMessages(
    messageRows,
    params.offload,
  );

  const safeTitle = buildSafeFilenameComponent(thread.title);
  const safeThreadId = buildSafeFilenameComponent(thread.id);
  const exportedAt = threadExportDeps.now();
  const filenameBase = `${safeTitle}-${safeThreadId}`;

  if (params.format === "json") {
    const payload = {
      thread: {
        id: thread.id,
        title: thread.title,
        created_at: thread.createdAt,
        updated_at: thread.updatedAt,
      },
      exported_at: exportedAt,
      messages: exportMessages.map((message) => ({
        role: message.role,
        content: message.content,
        sequence: message.sequence,
        created_at: message.createdAt,
      })),
    };
    return new Response(boundedTextBody(JSON.stringify(payload, null, 2)), {
      status: 200,
      headers: attachmentHeaders(
        "application/json; charset=utf-8",
        `${filenameBase}.json`,
      ),
    });
  }

  const markdown = [
    `# ${thread.title || "Untitled Thread"}`,
    "",
    `- Thread ID: \`${thread.id}\``,
    `- Exported: \`${exportedAt}\``,
    "",
    "## Messages",
    "",
    ...exportMessages.flatMap((message) => [
      `### #${message.sequence} [${message.role}] (${message.createdAt})`,
      "",
      message.content,
      "",
    ]),
  ].join("\n");

  return new Response(boundedTextBody(markdown), {
    status: 200,
    headers: attachmentHeaders(
      "text/markdown; charset=utf-8",
      `${filenameBase}.md`,
    ),
  });
}
