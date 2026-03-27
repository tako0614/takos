import type { ToolHandler } from '../../../types';
import { callSessionApi } from '../session';
import { validateContent } from '../limits';
import { logError, logWarn } from '../../../../../shared/utils/logger';
import { setupFileOperation, handleSessionApiResponse } from '../file-operations';

export const fileWriteHandler: ToolHandler = async (args, context) => {
  const { path, sessionId } = await setupFileOperation(args, context);
  const content = args.content as string;

  validateContent(content, path);

  const r2Key = `session-files/${context.spaceId}/${sessionId}/${path}`;

  const [runtimeResult, r2Result] = await Promise.allSettled([
    callSessionApi(context, '/session/file/write', { path, content }),
    context.storage?.put(r2Key, content, {
      customMetadata: {
        'workspace-id': context.spaceId,
        'session-id': sessionId,
        'path': path,
        'updated-at': new Date().toISOString(),
      },
    }),
  ]);

  if (r2Result.status === 'rejected') {
    logWarn(`R2 backup write failed for ${path}`, { module: 'tools/builtin/file/handlers/write', detail: r2Result.reason });
  }

  if (runtimeResult.status === 'rejected') {
    const r2Succeeded = r2Result.status === 'fulfilled';
    logError('Runtime write failed', runtimeResult.reason, { module: 'tools/builtin/file/handlers/write' });
    throw new Error(`Failed to write file: ${runtimeResult.reason}`);
  }

  const response = runtimeResult.value;

  const result = await handleSessionApiResponse<{ path: string; size: number }>(response, 'write file');
  return `Written file: ${result.path} (${result.size} bytes)`;
};
