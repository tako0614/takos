import type { ToolHandler } from '../../../types';
import { buildSessionPath, callSessionApi, requireContainer, resolveMountPath } from '../session';
import { validateBinaryContent } from '../limits';
import { logError, logWarn } from '../../../../../shared/utils/logger';

export const fileWriteBinaryHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined
  );
  const path = buildSessionPath(mountPath, args.path as string);
  const contentBase64 = args.content_base64 as string;

  validateBinaryContent(contentBase64, path);

  requireContainer(context);

  const r2Key = `session-files/${context.spaceId}/${context.sessionId}/${path}`;

  let binaryData: Uint8Array;
  try {
    const binaryString = atob(contentBase64);
    binaryData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      binaryData[i] = binaryString.charCodeAt(i);
    }
  } catch {
    throw new Error('Invalid base64 content');
  }

  const [runtimeResult, r2Result] = await Promise.allSettled([
    callSessionApi(context, '/session/file/write-binary', { path, content_base64: contentBase64 }),
    context.storage?.put(r2Key, binaryData, {
      customMetadata: {
        'workspace-id': context.spaceId,
        'session-id': context.sessionId || '',
        'path': path,
        'is-binary': 'true',
        'updated-at': new Date().toISOString(),
      },
    }),
  ]);

  if (r2Result.status === 'rejected') {
    logWarn(`R2 backup binary write failed for ${path}`, { module: 'tools/builtin/file/handlers/write-binary', detail: r2Result.reason });
  }

  if (runtimeResult.status === 'rejected') {
    const r2Succeeded = r2Result.status === 'fulfilled';
    logError('Runtime binary write failed', runtimeResult.reason, { module: 'tools/builtin/file/handlers/write-binary' });
    throw new Error(`Failed to write binary file: ${runtimeResult.reason}`);
  }

  const response = runtimeResult.value;
  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || 'Failed to write binary file');
  }

  const result = await response.json() as { path: string; size: number };
  return `Written binary file: ${result.path} (${result.size} bytes)`;
};
