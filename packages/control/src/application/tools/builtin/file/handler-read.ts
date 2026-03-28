import type { ToolHandler } from '../../types';
import { callSessionApi } from './session';
import { isBinaryFile } from './limits';
import { setupFileOperation, handleSessionApiResponse } from './file-operations';

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
