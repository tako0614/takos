import type { ToolHandler } from '../../../types';
import { buildSessionPath, callSessionApi, requireContainer, resolveMountPath } from '../session';
import { isBinaryFile } from '../limits';
import { logWarn } from '../../../../../shared/utils/logger';

export const fileRenameHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined
  );
  const oldPath = buildSessionPath(mountPath, args.old_path as string);
  const newPath = buildSessionPath(mountPath, args.new_path as string);

  requireContainer(context);

  const readResponse = await callSessionApi(context, '/session/file/read', {
    path: oldPath,
    binary: isBinaryFile(oldPath),
  });
  if (!readResponse.ok) {
    throw new Error(`Source file not found: ${oldPath}`);
  }
  const readResult = await readResponse.json() as {
    content: string;
    is_binary?: boolean;
    encoding?: 'utf-8' | 'base64';
  };

  const isBinary = Boolean(readResult.is_binary) || readResult.encoding === 'base64';
  const r2KeyOld = `session-files/${context.spaceId}/${context.sessionId}/${oldPath}`;
  const r2KeyNew = `session-files/${context.spaceId}/${context.sessionId}/${newPath}`;
  let binaryData: Uint8Array | null = null;
  if (isBinary) {
    try {
      const binaryString = atob(readResult.content);
      binaryData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        binaryData[i] = binaryString.charCodeAt(i);
      }
    } catch {
      throw new Error('Invalid base64 content');
    }
  }
  const writeResponse = await callSessionApi(
    context,
    isBinary ? '/session/file/write-binary' : '/session/file/write',
    isBinary
      ? { path: newPath, content_base64: readResult.content }
      : { path: newPath, content: readResult.content }
  );
  if (!writeResponse.ok) {
    const error = await writeResponse.json() as { error: string };
    throw new Error(error.error || 'Failed to write to new path');
  }

  await callSessionApi(context, '/session/file/delete', { path: oldPath });

  if (context.storage) {
    try {
      await context.storage.put(
        r2KeyNew,
        isBinary ? (binaryData as Uint8Array) : readResult.content,
        {
          customMetadata: {
            'workspace-id': context.spaceId,
            'session-id': context.sessionId || '',
            'path': newPath,
            ...(isBinary ? { 'is-binary': 'true' } : {}),
            'updated-at': new Date().toISOString(),
          },
        }
      );
    } catch (err) {
      logWarn(`R2 backup rename write failed for ${newPath}`, { module: 'tools/builtin/file/handlers/rename', detail: err });
    }
    try {
      await context.storage.delete(r2KeyOld);
    } catch (err) {
      logWarn(`R2 backup rename delete failed for ${oldPath}`, { module: 'tools/builtin/file/handlers/rename', detail: err });
    }
  }

  return `Renamed: ${oldPath} -> ${newPath}`;
};
