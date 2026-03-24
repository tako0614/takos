import type { ToolDefinition, ToolHandler } from '../types';
import { deployFrontendFromWorkspace } from '../../services/source/apps';

export const DEPLOY_FRONTEND: ToolDefinition = {
  name: 'deploy_frontend',
  description: 'Deploy a frontend build to /apps/{name}/ from workspace files',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      app_name: {
        type: 'string',
        description: 'App name (used for /apps/{name}/)',
      },
      dist_path: {
        type: 'string',
        description: 'Build output directory in workspace (default: dist)',
      },
      clear: {
        type: 'boolean',
        description: 'Delete existing app files before upload',
      },
      description: {
        type: 'string',
        description: 'Optional app description',
      },
      icon: {
        type: 'string',
        description: 'Optional app icon (emoji or URL)',
      },
    },
    required: ['app_name'],
  },
};

export const deployFrontendHandler: ToolHandler = async (args, context) => {
  const appName = String(args.app_name || '').trim();
  const distPath = String(args.dist_path || 'dist');
  const clear = Boolean(args.clear);
  const description = args.description ? String(args.description) : null;
  const icon = args.icon ? String(args.icon) : null;
  // Always use the caller's workspace — never allow LLM to target arbitrary workspaces
  const spaceId = context.spaceId;

  const result = await deployFrontendFromWorkspace(context.env, {
    spaceId,
    appName,
    distPath,
    clear,
    description,
    icon,
  });

  return [
    'Frontend deployed.',
    `App: ${result.appName}`,
    `Files: ${result.uploaded}`,
    `URL: ${result.url}`,
  ].join('\n');
};

export const DEPLOY_TOOLS: ToolDefinition[] = [DEPLOY_FRONTEND];
export const DEPLOY_HANDLERS: Record<string, ToolHandler> = {
  deploy_frontend: deployFrontendHandler,
};
