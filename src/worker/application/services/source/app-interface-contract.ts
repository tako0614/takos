import { TAKOSUMI_ACCOUNTS_CONTROL_API_PERMISSIONS } from "@takosjp/takosumi-accounts-contract";

export const TAKOS_APP_CONTRACT_VERSION = 1 as const;

export const APP_DEPLOYMENT_OUTPUT_KEY = "app_deployment" as const;
export const APP_DEPLOYMENT_OUTPUT_KEYS = [APP_DEPLOYMENT_OUTPUT_KEY] as const;

export const SERVICE_GRAPH_CAPABILITIES = {
  mcpServer: "protocol.mcp.server",
  httpApi: "protocol.http.api",
  interfaceFileHandler: "interface.file.handler",
  interfaceUiSurface: "interface.ui.surface",
  storageFilesystem: "storage.filesystem",
  storageObject: "storage.object",
  storageKeyValue: "storage.key_value",
  storageSql: "storage.sql",
  sourceRepository: "source.repository",
  sourceGitSmartHttp: "source.git.smart_http",
  automationAgentRuntime: "automation.agent_runtime",
  automationToolProvider: "automation.tool_provider",
  identityOidc: "identity.oidc",
  eventsWebhook: "events.webhook",
  billingUsage: "billing.usage",
  deploymentOutputs: "deployment.outputs",
  authBootstrapToken: "auth.bootstrap_token",
  controlApi: "control.api",
} as const;

export const TAKOS_APP_PUBLICATION_TYPES = SERVICE_GRAPH_CAPABILITIES;

export const TAKOS_APP_AUTH_KINDS = {
  bearer: "bearer",
  takosOidc: "takos_oidc",
} as const;

export const TAKOS_APP_SERVICE_BINDING_CAPABILITIES = [
  SERVICE_GRAPH_CAPABILITIES.controlApi,
] as const;

export const TAKOS_APP_SERVICE_GRANT_SCOPES = {
  [SERVICE_GRAPH_CAPABILITIES.controlApi]:
    TAKOSUMI_ACCOUNTS_CONTROL_API_PERMISSIONS,
} as const;

export type TakosAppContractVersion = typeof TAKOS_APP_CONTRACT_VERSION;
export type AppDeploymentOutputKey =
  (typeof APP_DEPLOYMENT_OUTPUT_KEYS)[number];
export type TakosAppPublicationType =
  (typeof TAKOS_APP_PUBLICATION_TYPES)[keyof typeof TAKOS_APP_PUBLICATION_TYPES];
export type ServiceGraphCapability =
  (typeof SERVICE_GRAPH_CAPABILITIES)[keyof typeof SERVICE_GRAPH_CAPABILITIES];
export type TakosAppAuthKind =
  (typeof TAKOS_APP_AUTH_KINDS)[keyof typeof TAKOS_APP_AUTH_KINDS];
export type TakosAppServiceBindingCapability =
  (typeof TAKOS_APP_SERVICE_BINDING_CAPABILITIES)[number];
export type TakosAppServiceGrantScope =
  (typeof TAKOSUMI_ACCOUNTS_CONTROL_API_PERMISSIONS)[number];
