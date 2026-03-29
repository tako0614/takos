import type { ToolDefinition, ToolHandler } from '../tool-definitions';
export declare const APP_DEPLOYMENT_LIST: ToolDefinition;
export declare const APP_DEPLOYMENT_GET: ToolDefinition;
export declare const APP_DEPLOYMENT_DEPLOY_FROM_REPO: ToolDefinition;
export declare const APP_DEPLOYMENT_REMOVE: ToolDefinition;
export declare const APP_DEPLOYMENT_ROLLBACK: ToolDefinition;
export declare const appDeploymentListHandler: ToolHandler;
export declare const appDeploymentGetHandler: ToolHandler;
export declare const appDeploymentDeployFromRepoHandler: ToolHandler;
export declare const appDeploymentRemoveHandler: ToolHandler;
export declare const appDeploymentRollbackHandler: ToolHandler;
export declare const WORKSPACE_APP_DEPLOYMENT_TOOLS: ToolDefinition[];
export declare const WORKSPACE_APP_DEPLOYMENT_HANDLERS: Record<string, ToolHandler>;
//# sourceMappingURL=space-app-deployments.d.ts.map