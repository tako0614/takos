/**
 * File read operation handlers.
 *
 * Consolidates: file_read, file_list.
 */

import type { ToolHandler } from '../../tool-definitions.ts';
import { callSessionApi } from './session.ts';
import { isBinaryFile } from './limits.ts';
import { setupFileOperation, handleSessionApiResponse } from './file-operations.ts';

/* ------------------------------------------------------------------ */
/*  file_read                                                          */
/* ------------------------------------------------------------------ */

export const fileReadHandler: ToolHandler = async (args, context) => {
  const { path } = await setupFileOperation(args, context);

  const binary = isBinaryFile(path);

  const response = await callSessionApi(context, '/session/file/read', {
    path,
    binary,
  });

  if (response.status === 404) {
    throw new Error(`File not found: ${path}`);
  }

  const result = await handleSessionApiResponse<{ content: string; size: number; is_binary?: boolean }>(response, 'read file');

  if (binary || result.is_binary) {
    return `[Binary file: ${path}]\nSize: ${result.size} bytes\nContent (base64): ${result.content.slice(0, 200)}${result.content.length > 200 ? '...' : ''}`;
  }

  return result.content;
};

/* ------------------------------------------------------------------ */
/*  file_list                                                          */
/* ------------------------------------------------------------------ */

export const fileListHandler: ToolHandler = async (args, context) => {
  const { path, mountPath } = await setupFileOperation(args, context);

  const response = await callSessionApi(context, '/session/file/list', { path });

  const result = await handleSessionApiResponse<{
    entries: Array<{ name: string; type: 'file' | 'dir'; size?: number }>;
  }>(response, 'list files');

  if (result.entries.length === 0) {
    return `No files found in ${path || mountPath || 'workspace root'}`;
  }

  const lines = result.entries
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => (e.type === 'dir' ? `📁 ${e.name}/` : `📄 ${e.name} (${e.size} bytes)`));

  return lines.join('\n');
};
