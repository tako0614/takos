import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import { createCommonEnvDeps, listSpaceCommonEnv, upsertSpaceCommonEnv, deleteSpaceCommonEnv } from '../../services/common-env/index.ts';

export const WORKSPACE_ENV_LIST: ToolDefinition = {
  name: 'workspace_env_list',
  description: 'List workspace common environment variables. Secret values are masked.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const WORKSPACE_ENV_SET: ToolDefinition = {
  name: 'workspace_env_set',
  description: 'Create or update a workspace common environment variable.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Environment variable name',
      },
      value: {
        type: 'string',
        description: 'Environment variable value',
      },
      secret: {
        type: 'boolean',
        description: 'Whether to store the value as a masked secret',
      },
    },
    required: ['name', 'value'],
  },
};

export const WORKSPACE_ENV_DELETE: ToolDefinition = {
  name: 'workspace_env_delete',
  description: 'Delete a workspace common environment variable.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Environment variable name',
      },
    },
    required: ['name'],
  },
};

export const workspaceEnvListHandler: ToolHandler = async (_args, context) => {
  const deps = createCommonEnvDeps(context.env);
  const env = await listSpaceCommonEnv(deps.spaceEnv, context.spaceId);

  return JSON.stringify({
    env,
    count: env.length,
  }, null, 2);
};

export const workspaceEnvSetHandler: ToolHandler = async (args, context) => {
  const name = String(args.name || '').trim();
  const value = String(args.value ?? '');
  const secret = args.secret === true;

  if (!name) {
    throw new Error('name is required');
  }

  const deps = createCommonEnvDeps(context.env);
  await upsertSpaceCommonEnv(deps.spaceEnv, {
    spaceId: context.spaceId,
    name,
    value,
    secret,
    actor: { type: 'user', userId: context.userId },
  });
  await deps.orchestrator.reconcileServicesForEnvKey(context.spaceId, name, 'workspace_env_put');

  return JSON.stringify({
    success: true,
    name,
    secret,
  }, null, 2);
};

export const workspaceEnvDeleteHandler: ToolHandler = async (args, context) => {
  const name = String(args.name || '').trim();
  if (!name) {
    throw new Error('name is required');
  }

  const deps = createCommonEnvDeps(context.env);
  const deleted = await deleteSpaceCommonEnv(
    deps.spaceEnv,
    context.spaceId,
    name,
    { type: 'user', userId: context.userId },
  );

  if (!deleted) {
    throw new Error(`Environment variable not found: ${name}`);
  }

  await deps.orchestrator.reconcileServicesForEnvKey(context.spaceId, name, 'workspace_env_delete');

  return JSON.stringify({
    success: true,
    name,
  }, null, 2);
};

export const WORKSPACE_COMMON_ENV_TOOLS: ToolDefinition[] = [
  WORKSPACE_ENV_LIST,
  WORKSPACE_ENV_SET,
  WORKSPACE_ENV_DELETE,
];

export const WORKSPACE_COMMON_ENV_HANDLERS: Record<string, ToolHandler> = {
  workspace_env_list: workspaceEnvListHandler,
  workspace_env_set: workspaceEnvSetHandler,
  workspace_env_delete: workspaceEnvDeleteHandler,
};
