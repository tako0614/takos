import { getDb, threads, messages } from '../../../infra/db/index.ts';
import { eq, asc } from 'drizzle-orm';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
import { logError } from '../../../shared/utils/logger.ts';
import { errorJsonResponse } from '../../../shared/utils/http-response.ts';

export const threadExportDeps = {
  getDb,
  logError,
  errorJsonResponse,
};

function buildSafeTitle(value: string | null | undefined): string {
  return (value || 'thread')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'thread';
}

export async function exportThread(
  params: {
    db: SqlDatabaseBinding;
    renderPdf?: (html: string) => Promise<ArrayBuffer>;
    threadId: string;
    includeInternal: boolean;
    includeInternalRolesAllowed: boolean;
    format: string;
  },
): Promise<Response | null> {
  const db = threadExportDeps.getDb(params.db);
  const thread = await db.select({ id: threads.id, title: threads.title, status: threads.status, createdAt: threads.createdAt, updatedAt: threads.updatedAt }).from(threads).where(eq(threads.id, params.threadId)).get();
  if (!thread || thread.status === 'deleted') {
    return null;
  }

  const allowedRoles = params.includeInternal && params.includeInternalRolesAllowed
    ? ['user', 'assistant', 'system', 'tool']
    : ['user', 'assistant'];

  const messageRows = await db.select({ role: messages.role, content: messages.content, sequence: messages.sequence, createdAt: messages.createdAt }).from(messages).where(eq(messages.threadId, params.threadId)).orderBy(asc(messages.sequence)).all();
  const filteredMessages = messageRows.filter(m => allowedRoles.includes(m.role));

  const safeTitle = buildSafeTitle(thread.title);
  const exportedAt = new Date().toISOString();

  if (params.format === 'json') {
    const payload = {
      thread: {
        id: thread.id,
        title: thread.title,
        created_at: thread.createdAt,
        updated_at: thread.updatedAt,
      },
      messages: filteredMessages.map((message) => ({
        role: message.role,
        content: message.content,
        sequence: message.sequence,
        created_at: message.createdAt,
      })),
    };

    const headers = new Headers();
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${safeTitle}-${thread.id}.json"`);
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(payload, null, 2), { status: 200, headers });
  }

  const markdown = [
    `# ${thread.title || 'Untitled Thread'}`,
    '',
    `- Thread ID: \`${thread.id}\``,
    `- Exported: \`${exportedAt}\``,
    '',
    '## Messages',
    '',
    ...filteredMessages.flatMap((message) => [
      `### #${message.sequence} [${message.role}] (${message.createdAt})`,
      '',
      message.content,
      '',
    ]),
  ].join('\n');

  if (params.format === 'markdown' || params.format === 'md') {
    const headers = new Headers();
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
    headers.set('Content-Disposition', `attachment; filename="${safeTitle}-${thread.id}.md"`);
    headers.set('Cache-Control', 'no-store');
    return new Response(markdown, { status: 200, headers });
  }

  if (params.format === 'pdf') {
    if (!params.renderPdf) {
      return errorJsonResponse('PDF export requires Browser rendering (BROWSER binding)', 503);
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(thread.title || 'Thread')}</title>
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
    <h1>${escapeHtml(thread.title || 'Untitled Thread')}</h1>
    <div class="meta">Thread ID: ${thread.id} | Exported: ${exportedAt}</div>
    ${filteredMessages.map((message) => (
      `<div class="msg"><div class="hdr">#${message.sequence} [${message.role}] ${message.createdAt}</div><pre>${escapeHtml(message.content || '')}</pre></div>`
    )).join('')}
  </body>
</html>`;

    try {
      const pdf = await params.renderPdf(html);
      const headers = new Headers();
      headers.set('Content-Type', 'application/pdf');
      headers.set('Content-Disposition', `attachment; filename="${safeTitle}-${thread.id}.pdf"`);
      headers.set('Cache-Control', 'no-store');
      return new Response(pdf, { status: 200, headers });
    } catch (err) {
      threadExportDeps.logError('PDF export failed', err, { module: 'services/threads/threads/thread-export' });
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not supported') ? 501 : 500;
      return threadExportDeps.errorJsonResponse('Failed to generate PDF', status);
    }
  }

  return threadExportDeps.errorJsonResponse('Invalid format. Supported: markdown, json, pdf', 400);
}
