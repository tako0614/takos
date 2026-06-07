// Public DTO contract surface consumed by the web SPA via the
// `takos-api-contract/shared/types` alias.
//
// This barrel re-exports the DTO subset the browser SPA actually imports,
// owned by the worker copies under src/worker/shared/types/ (the runtime-type
// owner). Worker-internal runtime shapes (bindings.ts, env.ts, drizzle-utils,
// queue internals, routing, api-scopes) are intentionally NOT re-exported here
// so worker secrets / Cloudflare binding types never leak onto a
// browser-consumed contract. Add a symbol below only when the SPA needs it.

export type {
  AgentTaskBase,
  AgentTaskPriority,
  AgentTaskResumeTarget,
  AgentTaskRunSummary,
  AgentTaskStatus,
} from "../../../../worker/shared/types/agent-tasks.ts";

export type {
  User,
} from "../../../../worker/shared/types/identity.ts";

export type {
  Memory,
  Reminder,
} from "../../../../worker/shared/types/memories.ts";

export type {
  PullRequestCommentAuthorType,
  PullRequestStatus,
  Repository,
  RepositoryVisibility,
  ReviewStatus,
} from "../../../../worker/shared/types/repositories.ts";

export type {
  Run,
  ToolExecution,
} from "../../../../worker/shared/types/runs.ts";

export type {
  AppType,
  ServiceStatus,
  ServiceType,
} from "../../../../worker/shared/types/services-resources.ts";

export type {
  Space,
  SpaceKind,
} from "../../../../worker/shared/types/spaces.ts";

export type {
  SpaceStorageFile,
  SpaceStorageFileType,
} from "../../../../worker/shared/types/storage.ts";

export type {
  ThreadHistoryArtifactSummary,
  ThreadHistoryChildRunSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from "../../../../worker/shared/types/thread-history.ts";

export type {
  Message,
  Thread,
} from "../../../../worker/shared/types/threads.ts";
