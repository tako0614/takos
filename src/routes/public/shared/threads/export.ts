import type {
  SpaceRole,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { readThreadAccess } from "./read-model.ts";

export type ThreadExportOptions = {
  format: string;
  includeInternal: boolean;
  renderPdf?: (html: string) => Promise<ArrayBuffer>;
};

type ExportMessageRow = {
  role: string;
  content: string;
  sequence: number;
  createdAt: string | Date;
};

type ThreadExportAccess = {
  thread: {
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  role: SpaceRole;
};

export async function exportThread(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  options: ThreadExportOptions,
): Promise<Response | null> {
  const access = await readThreadExportAccess(db, threadId, actorAccountId);
  if (!access || access.thread.status === "deleted") return null;

  const includeInternalRolesAllowed = access.role === "owner" ||
    access.role === "admin";
  const allowedRoles = options.includeInternal && includeInternalRolesAllowed
    ? new Set(["user", "assistant", "system", "tool"])
    : new Set(["user", "assistant"]);
  const messages = (await readExportMessages(db, threadId))
    .filter((message) => allowedRoles.has(message.role));
  const safeTitle = buildSafeTitle(access.thread.title);
  const exportedAt = new Date().toISOString();
  const format = options.format.toLowerCase();

  if (format === "json") {
    const payload = {
      thread: {
        id: access.thread.id,
        title: access.thread.title,
        created_at: access.thread.created_at,
        updated_at: access.thread.updated_at,
      },
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        sequence: message.sequence,
        created_at: toIsoString(message.createdAt),
      })),
    };

    return exportResponse(
      JSON.stringify(payload, null, 2),
      "application/json; charset=utf-8",
      `${safeTitle}-${access.thread.id}.json`,
    );
  }

  const markdown = [
    `# ${access.thread.title || "Untitled Thread"}`,
    "",
    `- Thread ID: \`${access.thread.id}\``,
    `- Exported: \`${exportedAt}\``,
    "",
    "## Messages",
    "",
    ...messages.flatMap((message) => [
      `### #${message.sequence} [${message.role}] (${
        toIsoString(message.createdAt)
      })`,
      "",
      message.content,
      "",
    ]),
  ].join("\n");

  if (format === "markdown" || format === "md") {
    return exportResponse(
      markdown,
      "text/markdown; charset=utf-8",
      `${safeTitle}-${access.thread.id}.md`,
    );
  }

  if (format === "pdf") {
    if (!options.renderPdf) {
      return jsonErrorResponse("PDF export renderer is not configured", 503);
    }

    const html = buildExportHtml(access.thread, messages, exportedAt);
    try {
      const pdf = await options.renderPdf(html);
      return exportResponse(
        pdf,
        "application/pdf",
        `${safeTitle}-${access.thread.id}.pdf`,
      );
    } catch {
      return jsonErrorResponse("Failed to generate PDF", 500);
    }
  }

  return jsonErrorResponse(
    "Invalid format. Supported: markdown, json, pdf",
    400,
  );
}

async function readThreadExportAccess(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
): Promise<ThreadExportAccess | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId);
  if (!access) return null;
  return {
    thread: {
      id: access.thread.id,
      title: access.thread.title,
      status: access.thread.status,
      created_at: access.thread.created_at,
      updated_at: access.thread.updated_at,
    },
    role: access.role,
  };
}

async function readExportMessages(
  db: SqlDatabaseBinding,
  threadId: string,
): Promise<ExportMessageRow[]> {
  const rows = await db.prepare(`
    SELECT
      role,
      content,
      sequence,
      created_at AS createdAt
    FROM messages
    WHERE thread_id = ?
    ORDER BY sequence ASC
  `).bind(threadId).all<Record<string, unknown>>();
  return rows.results.map(asExportMessageRow);
}

function exportResponse(
  body: BodyInit,
  contentType: string,
  filename: string,
): Response {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  return new Response(body, { status: 200, headers });
}

function jsonErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildSafeTitle(value: string | null | undefined): string {
  return (value || "thread")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "thread";
}

function buildExportHtml(
  thread: ThreadExportAccess["thread"],
  messages: ExportMessageRow[],
  exportedAt: string,
): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(thread.title || "Thread")}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { margin: 0 0 8px; font-size: 20px; }
      .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
      .msg { border-top: 1px solid #ddd; padding: 12px 0; }
      .hdr { font-size: 12px; color: #444; margin-bottom: 6px; }
      pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(thread.title || "Untitled Thread")}</h1>
    <div class="meta">Thread ID: ${escapeHtml(thread.id)} | Exported: ${
    escapeHtml(exportedAt)
  }</div>
    ${
    messages.map((message) => (
      `<div class="msg"><div class="hdr">#${message.sequence} [${
        escapeHtml(message.role)
      }] ${escapeHtml(toIsoString(message.createdAt))}</div><pre>${
        escapeHtml(message.content || "")
      }</pre></div>`
    )).join("")
  }
  </body>
</html>`;
}

function asExportMessageRow(row: Record<string, unknown>): ExportMessageRow {
  return {
    role: stringField(row, "role"),
    content: stringField(row, "content"),
    sequence: numberField(row, "sequence"),
    createdAt: dateField(row, "createdAt"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Thread export row field ${key} must be a string`);
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new TypeError(`Thread export row field ${key} must be a number`);
}

function dateField(row: Record<string, unknown>, key: string): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Thread export row field ${key} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
