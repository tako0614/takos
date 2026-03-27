/**
 * RPC Type Exports for Hono RPC Client
 *
 * This file provides type exports for the frontend RPC client.
 * The actual routes are composed in api.ts with middleware.
 *
 * Note: The routes are mounted at different paths, some at root level
 * (threads, runs, memories, etc.) and some at specific prefixes.
 */

import { Hono } from 'hono';
import type { Env } from '../../shared/types';
import type { ApiVariables } from './api';

// Re-export individual route types for RPC client type inference
import me from './me';
import spacesBase from './spaces/base';
import spacesMembers from './spaces/members';
import spacesRepos from './spaces/repositories';
import spacesStorage from './spaces/storage';
import spacesCommonEnv from './spaces/common-env';
import spacesStores from './spaces/stores';
import spacesStoreRegistry from './spaces/store-registry';
import services from './workers';
import resources from './resources';
import threads from './threads';
import runs from './runs/runs-routes';
import memories from './memories';
import skills from './skills';
import repos from './repos';
import explore from './explore';
import shortcuts from './shortcuts';
import setup from './setup';
import sessions from './sessions';
import agentTasks from './agent-tasks';
import { profilesApi } from './profiles';
import billing from './billing/billing-routes';
import notifications from './notifications';
import publicShare from './public-share';
import customDomains from './custom-domains';
import pullRequests from './pull-requests';
import appDeployments from './app-deployments';

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
  .route('/me', me)
  .route('/spaces', spacesBase)
  .route('/spaces', spacesMembers)
  .route('/spaces', spacesRepos)
  .route('/spaces', spacesStorage)
  .route('/spaces', spacesCommonEnv)
  .route('/spaces', spacesStores)
  .route('/spaces', spacesStoreRegistry)
  .route('/services', services)
  .route('/resources', resources)
  .route('/shortcuts', shortcuts)
  .route('/setup', setup)
  .route('/explore', explore)
  .route('/users', profilesApi)
  .route('/public', publicShare)
  .route('/billing', billing)
  // Root-mounted routes (have full paths in their definitions)
  .route('/', notifications)
  .route('/', threads)
  .route('/', runs)
  .route('/', sessions)
  .route('/', repos)
  .route('/', skills)
  .route('/', memories)
  .route('/', agentTasks)
  .route('/', appDeployments)
  .route('/', customDomains)
  .route('/', pullRequests);

export type ApiRoutes = typeof apiRoutes;
