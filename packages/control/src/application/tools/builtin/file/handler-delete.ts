import type { ToolHandler } from '../../types';
import { callSessionApi } from './session';
import { logError, logWarn } from '../../../../shared/utils/logger';
import { setupFileOperation, handleSessionApiResponse } from './file-operations';

export const fileDeleteHandler: ToolHandler = async (args, context) => {
  const { path, sessionId } = await setupFileOperation(args, context);

  const r2Key = `session-files/${context.spaceId}/${sessionId}/${path}`;

  const [runtimeResult, r2Result] = await Promise.allSettled([
    callSessionApi(context, '/session/file/delete', { path }),
    context.storage?.delete(r2Key),
  ]);

  if (r2Result.status === 'rejected') {
    logWarn(`R2 backup delete failed for ${path}`, { module: 'tools/builtin/file/handler-delete', detail: r2Result.reason });
  }

  if (runtimeResult.status === 'rejected') {
    const r2Succeeded = r2Result.status === 'fulfilled';
    logError('Runtime delete failed', runtimeResult.reason, { module: 'tools/builtin/file/handler-delete' });
    throw new Error(`Failed to delete file: ${runtimeResult.reason}`);
  }

  const response = runtimeResult.value;
  if (response.status === 404) {
    throw new Error(`File not found: ${path}`);
  }

  await handleSessionApiResponse(response, 'delete file');

  return `Deleted file: ${path}`;
};
