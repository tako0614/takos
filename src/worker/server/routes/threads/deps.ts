import { routeAuthDeps } from "../route-auth.ts";
import {
  checkThreadAccess,
  createMessage,
  createThread,
  deleteThread,
  listThreads,
  updateThread,
  updateThreadStatus,
} from "../../../application/services/threads/thread-service.ts";
import {
  createThreadShare,
  listThreadShares,
  revokeThreadShare,
} from "../../../application/services/threads/thread-shares.ts";
import {
  searchSpaceThreads,
  searchThreadMessages,
} from "../../../application/services/threads/thread-search.ts";
import { getThreadTimeline } from "../../../application/services/threads/thread-timeline.ts";
import { getThreadHistory } from "../../../application/services/threads/thread-history.ts";
import { exportThread } from "../../../application/services/threads/thread-export.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";

export const threadsRouteDeps = {
  requireSpaceAccess: routeAuthDeps.requireSpaceAccess,
  checkThreadAccess,
  createMessage,
  createThread,
  deleteThread,
  listThreads,
  updateThread,
  updateThreadStatus,
  createThreadShare,
  listThreadShares,
  revokeThreadShare,
  searchSpaceThreads,
  searchThreadMessages,
  getThreadTimeline,
  getThreadHistory,
  exportThread,
  getPlatformServices,
};

export const threadMessagesRouteDeps = threadsRouteDeps;
export const threadSharesRouteDeps = threadsRouteDeps;
