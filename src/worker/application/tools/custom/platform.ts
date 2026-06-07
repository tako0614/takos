import { mergeDefinedTools } from "./define-tools.ts";
import {
  WORKER_SETTINGS_HANDLERS,
  WORKER_SETTINGS_TOOLS,
} from "./platform/worker-settings.ts";
import { DOMAIN_HANDLERS, DOMAIN_TOOLS } from "./platform/domains.ts";
import {
  DEPLOYMENT_HANDLERS,
  DEPLOYMENT_TOOLS,
} from "./platform/deployments.ts";
import {
  DEPLOYMENT_HISTORY_HANDLERS,
  DEPLOYMENT_HISTORY_TOOLS,
} from "./platform/deployment-history.ts";

export {
  WORKER_ENV_GET as SERVICE_ENV_GET,
  WORKER_ENV_SET as SERVICE_ENV_SET,
  WORKER_RUNTIME_GET as SERVICE_RUNTIME_GET,
  WORKER_RUNTIME_SET as SERVICE_RUNTIME_SET,
  workerEnvGetHandler,
  workerEnvSetHandler,
  workerRuntimeGetHandler,
  workerRuntimeSetHandler,
} from "./platform/worker-settings.ts";

export {
  DOMAIN_ADD,
  DOMAIN_LIST,
  DOMAIN_REMOVE,
  DOMAIN_VERIFY,
  domainAddHandler,
  domainListHandler,
  domainRemoveHandler,
  domainVerifyHandler,
} from "./platform/domains.ts";

export {
  WORKER_CREATE as SERVICE_CREATE,
  WORKER_DELETE as SERVICE_DELETE,
  WORKER_LIST as SERVICE_LIST,
  workerCreateHandler,
  workerDeleteHandler,
  workerListHandler,
} from "./platform/deployments.ts";

export {
  DEPLOYMENT_GET,
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_ROLLBACK,
  deploymentGetHandler,
  deploymentHistoryHandler,
  deploymentRollbackHandler,
} from "./platform/deployment-history.ts";

export const { tools: PLATFORM_TOOLS, handlers: PLATFORM_HANDLERS } =
  mergeDefinedTools([
    { tools: WORKER_SETTINGS_TOOLS, handlers: WORKER_SETTINGS_HANDLERS },
    { tools: DOMAIN_TOOLS, handlers: DOMAIN_HANDLERS },
    { tools: DEPLOYMENT_TOOLS, handlers: DEPLOYMENT_HANDLERS },
    { tools: DEPLOYMENT_HISTORY_TOOLS, handlers: DEPLOYMENT_HISTORY_HANDLERS },
  ]);
