export const deploy = {
  // Resources
  resources: "Resources",
  noResources: "No resources yet",
  createResource: "Create Resource",
  shareResource: "Share",
  addDomain: "Add Domain",
  adding: "Adding...",
  add: "Add",

  // Worker Settings
  envVars: "Environment",
  bindings: "Bindings",
  runtime: "Runtime",
  varName: "Name",
  varValue: "Value",
  plainText: "Plain",
  secret: "Secret",
  saveEnvVars: "Save Environment Variables",
  bindingsHint: "Bind D1, R2, KV resources to your worker",
  noBindings: "No bindings",
  addBinding: "Add binding",
  saveBindings: "Save Bindings",
  compatibilityDate: "Compatibility Date",
  cpuLimit: "CPU Limit",
  compatibilityFlags: "Compatibility Flags",
  compatibilityFlagsHint: "Comma separated",
  subrequestsLimit: "Subrequests Limit",
  subrequestsHint: "Max external API calls",
  saveRuntime: "Save Runtime Settings",
  hostname: "Hostname",
  lastUpdated: "Last Updated",

  // General Settings
  general: "General",
  subdomain: "Subdomain",
  saveSubdomain: "Save Subdomain",
  currentUrl: "Current URL",
  workerId: "Worker ID",

  // Domain Settings
  domains: "Domains",
  platformDomain: "Platform Domain",
  noCustomDomains: "No custom domains",
  domainAdded: "Domain added",
  domainVerified: "Domain verified",
  verifyDomain: "Verify DNS",
  verificationFailed: "Verification failed",
  domainActive: "Active",
  domainPending: "Pending DNS",
  cnameInstruction: "Add DNS record",
  dnsSetup: "DNS Setup",

  // Deployment Detail
  status: "Status",
  stop: "Stop",
  open: "Open",
  customDomains: "Custom Domains",
  dangerZone: "Danger Zone",
  saved: "Saved",
  created: "Created",
  deleteResource: "Delete Resource",
  confirmDeleteResource: "Delete this resource?",
  type: "Type",

  // Workers
  workers: "Workers",
  noWorkers: "No workers yet",
  deleteWorker: "Delete Worker",
  stopWorker: "Stop Worker",
  confirmStopWorker: "Are you sure you want to stop this worker?",
  confirmDeleteWorker:
    "Are you sure you want to delete this worker? All data will be lost.",
  retry: "Retry",
  retryStarted: "Retry started",
  failedToRetry: "Failed to retry",
  failedToAddDomain: "Failed to add domain",
  stopped: "Stopped",
  failedToStop: "Failed to stop",

  // Deployment Logs
  deploymentHistory: "Deployment History",
  deploymentEvents: "Events",
  deploymentFailed: "Deployment Failed",
  bundleHash: "Bundle Hash",
  bundleSize: "Bundle Size",
  deployedBy: "Deployed By",
  deployStatus_pending: "Pending",
  deployStatus_in_progress: "In Progress",
  deployStatus_success: "Success",
  deployStatus_failed: "Failed",
  deployStatus_rolled_back: "Rolled Back",
  routingStatus_active: "Active",
  routingStatus_canary: "Canary",
  routingStatus_rollback: "Rollback",
  routingStatus_archived: "Archived",
  confirmRollback: "Rollback",
  rollbackWarning:
    "Switch traffic to deployment v{version}. This takes effect immediately.",
  rollback: "Rollback",
  rollbackApplied: "Rollback applied",
  failedToRollback: "Failed to rollback",
  rollbackToVersion: "Rollback to v{version}",

  // Resource Bindings
  boundWorkers: "Bound Workers",
  boundWorkersHint: "Workers that are using this resource",
  noBindingsHint: "No workers are currently bound to this resource",
  removeBinding: "Remove Binding",
  bindingRemoved: "Binding removed",
  failedToRemoveBinding: "Failed to remove binding",

  // Environment Variables & Secrets
  environmentVariables: "Environment Variables",
  envVarsDescription: "Plain text environment variables visible in your code.",
  noEnvVars: "No environment variables",
  secrets: "Secrets",
  secretsDescription: "Encrypted secrets that are masked in logs and UI.",
  noSecrets: "No secrets",
  addNewVariable: "Add New Variable",
  deleteEnvVar: "Delete Variable",
  confirmDeleteEnvVar:
    "Are you sure you want to delete this environment variable?",
  deleteSecret: "Delete Secret",
  confirmDeleteSecret: "Are you sure you want to delete this secret?",
  showSecret: "Show secret value",
  hideSecret: "Hide secret value",

  // Resource Access Tokens
  tokenCreated: "Token created",
  tokenDeleted: "Token deleted",
  failedToCreateToken: "Failed to create token",
  failedToDeleteToken: "Failed to delete token",

  // Deploy Panel
  resourceCreated: "Resource created",
  resourceDeleted: "Resource deleted",

  // Deploy Sidebar
  repositories: "Repositories",

  // Create Resource Modal
  d1Database: "D1 Database",
  r2Storage: "R2 Storage",
  kvStore: "KV Store",
  vectorizeIndex: "Vectorize Index",

  // R2 Browser
  r2LastModified: "Last Modified",
  r2LoadMore: "Load More",
  r2DeleteConfirm: 'Are you sure you want to delete "{key}"?',

  // Detail Page
  overview: "Overview",
  explorer: "Explorer",
  browser: "Browser",
  tables: "Tables",
  noTables: "No tables",
  execute: "Execute",
  result: "Result",
  noObjects: "No objects",
  size: "Size",
  createdAt: "Created",
  deleteResourceWarning:
    "This action cannot be undone. All associated data will be deleted.",

  // Workers Tab
  useAgentToCreateWorker: "Use the agent to deploy workers",

  // Resource Overview
  connectionInfo: "Connection Information",
  loadingConnectionInfo: "Loading connection info...",
  connectionInfoNotAvailable: "Connection info not available",
  accessTokens: "Access Tokens",
  loadingTokens: "Loading tokens...",
  noAccessTokens: "No access tokens created yet",
  tokensCreatedCount: "{count} token(s) created",
  generateTokenButton: "Generate Token",
  generateAccessTokenTitle: "Generate Access Token",
  tokenCreatedTitle: "Token Created",
  tokenCreatedSuccessfully: "Token created successfully",
  copyTokenNow: "Copy this token now. You won't be able to see it again.",
  accessTokenLabel: "Access Token",
  tokenNameLabel: "Token Name",
  permissionLabel: "Permission",
  readOnly: "Read only",
  readWrite: "Read & Write",
  expirationLabel: "Expiration (optional)",
  neverExpires: "Never expires",
  days7: "7 days",
  days30: "30 days",
  days90: "90 days",
  year1: "1 year",

  // D1 Explorer
  sqlConsole: "SQL Console",
} as const;
