// Re-export all platform schema tables from domain-specific files.
// This barrel file preserves backward compatibility for existing importers.

export {
  edges,
  fileHandlerMatchers,
  fileHandlers,
  infraEndpointRoutes,
  infraEndpoints,
  infraWorkers,
  nodes,
  serviceEndpoints,
  serviceRuntimes,
  shortcutGroupItems,
  shortcutGroups,
  shortcuts,
  uiExtensions,
} from "./schema-platform-infra.ts";

export {
  notificationPreferences,
  notifications,
  notificationSettings,
  sessionFiles,
  sessionRepos,
  sessions,
} from "./schema-platform-notifications.ts";

export { moderationAuditLogs, reports } from "./schema-platform-moderation.ts";

export {
  resourceAccess,
  resourceAccessTokens,
  resources,
} from "./schema-platform-resources.ts";

export {
  apDeliveryQueue,
  apFollowers,
  repoGrants,
  repoPushActivities,
  storeInventoryItems,
  storeRegistry,
  storeRegistryUpdates,
} from "./schema-platform-store.ts";

export { dlqEntries } from "./schema-platform-dlq.ts";

export {
  defaultAppDistributionConfig,
  defaultAppDistributionEntries,
  defaultAppPreinstallJobs,
} from "./schema-default-app-distribution.ts";
