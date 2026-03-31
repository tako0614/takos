import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import { AppDeploymentService } from '../../services/platform/app-deployments.ts';

export const APP_DEPLOYMENT_LIST: ToolDefinition = {
  name: 'app_deployment_list',
  description: 'List app deployments in this workspace.',
  category: 'workspace',
  parameters: { type: 'object', properties: {} },
};

export const APP_DEPLOYMENT_GET: ToolDefinition = {
  name: 'app_deployment_get',
  description: 'Get app deployment details by ID.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      app_deployment_id: { type: 'string', description: 'App deployment ID' },
    },
    required: ['app_deployment_id'],
  },
};

export const APP_DEPLOYMENT_DEPLOY_FROM_REPO: ToolDefinition = {
  name: 'app_deployment_deploy_from_repo',
  description: 'Deploy an app from a repository ref using .takos/app.yml.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      repo_id: { type: 'string', description: 'Repository ID' },
      ref: { type: 'string', description: 'Branch, tag, or commit ref' },
      ref_type: { type: 'string', enum: ['branch', 'tag', 'commit'], description: 'Ref type' },
      approve_oauth_auto_env: { type: 'boolean', description: 'Approve OAuth auto env changes' },
      approve_source_change: { type: 'boolean', description: 'Approve source change' },
    },
    required: ['repo_id', 'ref'],
  },
};

export const APP_DEPLOYMENT_REMOVE: ToolDefinition = {
  name: 'app_deployment_remove',
  description: 'Remove an app deployment and its managed resources.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      app_deployment_id: { type: 'string', description: 'App deployment ID' },
    },
    required: ['app_deployment_id'],
  },
};

export const APP_DEPLOYMENT_ROLLBACK: ToolDefinition = {
  name: 'app_deployment_rollback',
  description: 'Rollback an app deployment to the previous version.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      app_deployment_id: { type: 'string', description: 'App deployment ID' },
      approve_oauth_auto_env: { type: 'boolean', description: 'Approve OAuth auto env changes' },
    },
    required: ['app_deployment_id'],
  },
};

export const appDeploymentListHandler: ToolHandler = async (_args, context) => {
  const service = new AppDeploymentService(context.env);
  return JSON.stringify({
    app_deployments: await service.list(context.spaceId),
  }, null, 2);
};

export const appDeploymentGetHandler: ToolHandler = async (args, context) => {
  const id = String(args.app_deployment_id || '').trim();
  if (!id) throw new Error('app_deployment_id is required');
  const service = new AppDeploymentService(context.env);
  const deployment = await service.get(context.spaceId, id);
  if (!deployment) throw new Error(`App deployment not found: ${id}`);
  return JSON.stringify({ app_deployment: deployment }, null, 2);
};

export const appDeploymentDeployFromRepoHandler: ToolHandler = async (args, context) => {
  const repoId = String(args.repo_id || '').trim();
  const ref = String(args.ref || '').trim();
  const refType = String(args.ref_type || 'branch').trim().toLowerCase();
  if (!repoId) throw new Error('repo_id is required');
  if (!ref) throw new Error('ref is required');
  if (refType !== 'branch' && refType !== 'tag' && refType !== 'commit') {
    throw new Error('ref_type must be one of: branch, tag, commit');
  }
  const service = new AppDeploymentService(context.env);
  const result = await service.deployFromRepoRef(context.spaceId, context.userId, {
    repoId,
    ref,
    refType,
    approveOauthAutoEnv: args.approve_oauth_auto_env === true,
    approveSourceChange: args.approve_source_change === true,
  });
  return JSON.stringify({ success: true, data: result }, null, 2);
};

export const appDeploymentRemoveHandler: ToolHandler = async (args, context) => {
  const id = String(args.app_deployment_id || '').trim();
  if (!id) throw new Error('app_deployment_id is required');
  const service = new AppDeploymentService(context.env);
  await service.remove(context.spaceId, id);
  return JSON.stringify({ success: true, app_deployment_id: id }, null, 2);
};

export const appDeploymentRollbackHandler: ToolHandler = async (args, context) => {
  const id = String(args.app_deployment_id || '').trim();
  if (!id) throw new Error('app_deployment_id is required');
  const service = new AppDeploymentService(context.env);
  const result = await service.rollback(context.spaceId, context.userId, id, {
    approveOauthAutoEnv: args.approve_oauth_auto_env === true,
  });
  return JSON.stringify({ success: true, data: result }, null, 2);
};

export const WORKSPACE_APP_DEPLOYMENT_TOOLS = [
  APP_DEPLOYMENT_LIST,
  APP_DEPLOYMENT_GET,
  APP_DEPLOYMENT_DEPLOY_FROM_REPO,
  APP_DEPLOYMENT_REMOVE,
  APP_DEPLOYMENT_ROLLBACK,
];

export const WORKSPACE_APP_DEPLOYMENT_HANDLERS: Record<string, ToolHandler> = {
  app_deployment_list: appDeploymentListHandler,
  app_deployment_get: appDeploymentGetHandler,
  app_deployment_deploy_from_repo: appDeploymentDeployFromRepoHandler,
  app_deployment_remove: appDeploymentRemoveHandler,
  app_deployment_rollback: appDeploymentRollbackHandler,
};
