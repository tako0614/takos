// control.api runtime-authority scope contract. Re-localized in the Takos
// product after Takosumi OSS removed the runtime projection ledger (deploy decision
// D3): the permission token set is the Takos manifest contract for a
// `control.api` runtime binding and no longer lives in the accounts contract.
export const TAKOS_CONTROL_API_PERMISSIONS = [
  "installations.list.same-space",
  "installations.read.same-space",
  "installations.events.read.same-space",
  "installations.outputs.read.same-space",
  "billing.usage.report.same-space",
] as const;

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
  controlApi: "control.api",
} as const;

export const TAKOS_APP_PUBLICATION_TYPES = RUNTIME_PROJECTION_CAPABILITIES;

export const TAKOS_APP_AUTH_KINDS = {
  bearer: "bearer",
  takosOidc: "takos_oidc",
} as const;

export const TAKOS_APP_SERVICE_BINDING_CAPABILITIES = [
  RUNTIME_PROJECTION_CAPABILITIES.controlApi,
] as const;

export const TAKOS_APP_SERVICE_GRANT_SCOPES = {
  [RUNTIME_PROJECTION_CAPABILITIES.controlApi]: TAKOS_CONTROL_API_PERMISSIONS,
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
export type TakosAppServiceBindingCapability =
  (typeof TAKOS_APP_SERVICE_BINDING_CAPABILITIES)[number];
export type TakosAppServiceGrantScope =
  (typeof TAKOS_CONTROL_API_PERMISSIONS)[number];
