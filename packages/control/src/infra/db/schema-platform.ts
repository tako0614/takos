// Re-export all platform schema tables from domain-specific files.
// This barrel file preserves backward compatibility for existing importers.

export {
  edges,
  fileHandlerMatchers,
  fileHandlers,
  infraEndpointRoutes,
  infraEndpoints,
  serviceEndpoints,
  serviceRuntimes,
  infraWorkers,
  nodes,
  shortcutGroupItems,
  shortcutGroups,
  shortcuts,
  uiExtensions,
} from './schema-platform-infra';

export {
  notificationPreferences,
  notificationSettings,
  notifications,
  sessionFiles,
  sessionRepos,
  sessions,
} from './schema-platform-notifications';

export {
  moderationAuditLogs,
  reports,
} from './schema-platform-moderation';

export {
  resourceAccess,
  resourceAccessTokens,
  resources,
} from './schema-platform-resources';

export {
  storeRegistry,
  storeRegistryUpdates,
} from './schema-platform-store';

export {
  dlqEntries,
} from './schema-platform-dlq';
