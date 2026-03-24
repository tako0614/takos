import type { ToolHandler } from '../../../types';
import { buildSessionPath, callSessionApi, requireContainer, resolveMountPath } from '../session';

export const fileMkdirHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined
  );
  const dirPath = buildSessionPath(mountPath, (args.path as string).replace(/\/+$/, ''));

  requireContainer(context);

  const response = await callSessionApi(context, '/session/file/write', {
    path: `${dirPath}/.gitkeep`,
    content: '',
  });

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || 'Failed to create directory');
  }

  return `Created directory: ${dirPath}/`;
};
