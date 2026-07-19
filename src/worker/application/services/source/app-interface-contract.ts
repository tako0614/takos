export const TAKOS_APP_CONTRACT_VERSION = 1 as const;

export const APP_DEPLOYMENT_OUTPUT_KEY = "app_deployment" as const;
export const APP_DEPLOYMENT_OUTPUT_KEYS = [
  APP_DEPLOYMENT_OUTPUT_KEY,
] as const;

export const TAKOS_RUNTIME_PROJECTION_PUBLICATIONS = {
  workspaceStorage: "storage.filesystem",
} as const;

export const RUNTIME_PROJECTION_CAPABILITIES = {
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
} as const;

export const TAKOS_APP_PUBLICATION_TYPES = RUNTIME_PROJECTION_CAPABILITIES;

export const TAKOS_APP_AUTH_KINDS = {
  bearer: "bearer",
  takosOidc: "takos_oidc",
} as const;

export type TakosAppContractVersion = typeof TAKOS_APP_CONTRACT_VERSION;
export type AppDeploymentOutputKey =
  (typeof APP_DEPLOYMENT_OUTPUT_KEYS)[number];
export type TakosAppPublicationType =
  (typeof TAKOS_APP_PUBLICATION_TYPES)[keyof typeof TAKOS_APP_PUBLICATION_TYPES];
export type RuntimeProjectionCapability =
  (typeof RUNTIME_PROJECTION_CAPABILITIES)[keyof typeof RUNTIME_PROJECTION_CAPABILITIES];
export type TakosAppAuthKind =
  (typeof TAKOS_APP_AUTH_KINDS)[keyof typeof TAKOS_APP_AUTH_KINDS];
