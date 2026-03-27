import type { ToolHandler } from '../../../types';
import { callSessionApi } from '../session';
import { setupFileOperation, handleSessionApiResponse } from '../file-operations';

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
