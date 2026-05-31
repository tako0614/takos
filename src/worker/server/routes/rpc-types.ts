/**
 * RPC Type Exports for Hono RPC Client
 *
 * This file provides type exports for the frontend RPC client.
 * The actual routes are composed in api.ts with middleware.
 *
 * Note: The routes are mounted at different paths, some at root level
 * (threads, runs, memories, etc.) and some at specific prefixes.
 */

import { Hono } from "hono";
import type { Env } from "../../shared/types/index.ts";
import type { ApiVariables } from "./api.ts";

// Re-export individual route types for RPC client type inference
import me from "./me/index.ts";
import spacesBase from "./spaces/routes.ts";
import spacesMembers from "./spaces/members.ts";
import spacesRepos from "./spaces/repositories.ts";
import spacesStorage from "./spaces/storage.ts";
import spacesStores from "./spaces/stores.ts";
import spacesStoreRegistry from "./spaces/store-registry.ts";
import spacesTools from "./spaces/tools.ts";
import services from "./workers/index.ts";
import resources from "./resources/index.ts";
import threads from "./threads.ts";
import runs from "./runs/routes.ts";
import memories from "./memories/index.ts";
import skills from "./skills.ts";
import repos from "./repos/index.ts";
import shortcuts from "./shortcuts/index.ts";
import setup from "./setup.ts";
import sessions from "./sessions/index.ts";
import agentTasks from "./agent-tasks/index.ts";
import { profilesApi } from "./profiles/index.ts";
import notifications from "./notifications/index.ts";
import publicShare from "./public-share/index.ts";
import customDomains from "./custom-domains.ts";
import pullRequests from "./pull-requests/index.ts";
import { workersSpaceRoutes } from "./workers/routes.ts";

export type { ApiVariables };

// Base Hono type for API routes
export type ApiEnv = { Bindings: Env; Variables: ApiVariables };

/**
 * Combined API routes for RPC client type inference.
 *
 * This mirrors the route mounting in api.ts:
 * - Routes at specific prefixes: /me, /spaces, /services, etc.
 * - Routes at root level: threads, runs, memories (they have full paths like /spaces/:spaceId/threads)
 */
const apiRoutes = new Hono<ApiEnv>()
  // Prefixed routes
  .route("/me", me)
  .route("/spaces", spacesBase)
  .route("/spaces", spacesMembers)
  .route("/spaces", spacesRepos)
  .route("/spaces", spacesStorage)
  .route("/spaces", spacesStores)
  .route("/spaces", spacesStoreRegistry)
  .route("/spaces", spacesTools)
  .route("/spaces", workersSpaceRoutes)
  .route("/services", services)
  .route("/resources", resources)
  .route("/shortcuts", shortcuts)
  .route("/setup", setup)
  .route("/users", profilesApi)
  .route("/public", publicShare)
  // Root-mounted routes (have full paths in their definitions)
  .route("/", notifications)
  .route("/", threads)
  .route("/", runs)
  .route("/", sessions)
  .route("/", repos)
  .route("/", skills)
  .route("/", memories)
  .route("/", agentTasks)
  .route("/", customDomains)
  .route("/", pullRequests);

export type ApiRoutes = typeof apiRoutes;
