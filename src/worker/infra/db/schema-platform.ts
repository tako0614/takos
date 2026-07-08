// Re-export all platform schema tables from domain-specific files.
// This barrel is the current public schema entry point.

export {
  edges,
  interfaceFileHandlerMatchers,
  interfaceFileHandlers,
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
  mobilePushRegistrations,
  notificationPushers,
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
  resources,
  secretRotationEvents,
  secretVersions,
} from "./schema-platform-resources.ts";

export { repoGrants } from "./schema-platform-store.ts";

export { dlqEntries } from "./schema-platform-dlq.ts";

export {
  featuredAppCatalogConfig,
  featuredAppCatalogEntries,
  featuredAppPreinstallJobs,
} from "./schema-featured-app-catalog.ts";
