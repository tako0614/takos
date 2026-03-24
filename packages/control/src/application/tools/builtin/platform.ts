import type { ToolDefinition, ToolHandler } from '../types';
import { WORKER_SETTINGS_TOOLS, WORKER_SETTINGS_HANDLERS } from './platform/worker-settings';
import { DOMAIN_TOOLS, DOMAIN_HANDLERS } from './platform/domains';
import { DEPLOYMENT_TOOLS, DEPLOYMENT_HANDLERS } from './platform/deployments';
import { DEPLOYMENT_HISTORY_TOOLS, DEPLOYMENT_HISTORY_HANDLERS } from './platform/deployment-history';

export {
  WORKER_ENV_GET as SERVICE_ENV_GET,
  WORKER_ENV_SET as SERVICE_ENV_SET,
  WORKER_BINDINGS_GET as SERVICE_BINDINGS_GET,
  WORKER_BINDINGS_SET as SERVICE_BINDINGS_SET,
  WORKER_RUNTIME_GET as SERVICE_RUNTIME_GET,
  WORKER_RUNTIME_SET as SERVICE_RUNTIME_SET,
  workerEnvGetHandler,
  workerEnvSetHandler,
  workerBindingsGetHandler,
  workerBindingsSetHandler,
  workerRuntimeGetHandler,
  workerRuntimeSetHandler,
} from './platform/worker-settings';

export {
  DOMAIN_LIST,
  DOMAIN_ADD,
  DOMAIN_VERIFY,
  DOMAIN_REMOVE,
  domainListHandler,
  domainAddHandler,
  domainVerifyHandler,
  domainRemoveHandler,
} from './platform/domains';

export {
  WORKER_LIST as SERVICE_LIST,
  WORKER_CREATE as SERVICE_CREATE,
  WORKER_DELETE as SERVICE_DELETE,
  workerListHandler,
  workerCreateHandler,
  workerDeleteHandler,
} from './platform/deployments';

export {
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_GET,
  DEPLOYMENT_ROLLBACK,
  deploymentHistoryHandler,
  deploymentGetHandler,
  deploymentRollbackHandler,
} from './platform/deployment-history';

export const PLATFORM_TOOLS: ToolDefinition[] = [
  ...WORKER_SETTINGS_TOOLS,
  ...DOMAIN_TOOLS,
  ...DEPLOYMENT_TOOLS,
  ...DEPLOYMENT_HISTORY_TOOLS,
];

export const PLATFORM_HANDLERS: Record<string, ToolHandler> = {
  ...WORKER_SETTINGS_HANDLERS,
  ...DOMAIN_HANDLERS,
  ...DEPLOYMENT_HANDLERS,
  ...DEPLOYMENT_HISTORY_HANDLERS,
};
