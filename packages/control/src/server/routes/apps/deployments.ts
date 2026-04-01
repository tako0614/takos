import { Hono } from "hono";
import { z } from "zod";
import type { Env as _Env } from "../../../shared/types/index.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { GoneError, InternalError, isAppError } from "takos-common/errors";
import { APP_DEPLOYMENTS_REMOVED_MESSAGE } from "../../../application/services/platform/app-deployments.ts";
import { zValidator } from "../zod-validator.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";

function handleRouteError(error: unknown, context: string): never {
  if (isAppError(error)) throw error;
  logError(`${context} error`, error, { module: "routes/app-deployments" });
  throw new InternalError(`Failed to ${context}`);
}

function throwRemovedAppDeployments(): never {
  throw new GoneError(APP_DEPLOYMENTS_REMOVED_MESSAGE);
}

const createAppDeploymentSchema = z.object({
  repo_id: z.string().min(1),
  ref: z.string().min(1),
  ref_type: z.enum(["branch", "tag", "commit"]).optional(),
  approve_oauth_auto_env: z.boolean().optional(),
  approve_source_change: z.boolean().optional(),
});
const rollbackSchema = z.object({
  approve_oauth_auto_env: z.boolean().optional(),
});

const APP_DEPLOYMENT_LIST_ROLES =
  getSpaceOperationPolicy("app_deployment.list").allowed_roles;
const APP_DEPLOYMENT_GET_ROLES =
  getSpaceOperationPolicy("app_deployment.get").allowed_roles;
const APP_DEPLOYMENT_DEPLOY_ROLES =
  getSpaceOperationPolicy("app_deployment.deploy_from_repo").allowed_roles;
const APP_DEPLOYMENT_ROLLBACK_ROLES =
  getSpaceOperationPolicy("app_deployment.rollback").allowed_roles;
const APP_DEPLOYMENT_REMOVE_ROLES =
  getSpaceOperationPolicy("app_deployment.remove").allowed_roles;

const routes = new Hono<SpaceAccessRouteEnv>()
  .post(
    "/spaces/:spaceId/app-deployments",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    zValidator("json", createAppDeploymentSchema),
    async (_c) => {
      try {
        c.req.valid("json");
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "deploy app");
      }
    },
  )
  .get(
    "/spaces/:spaceId/app-deployments",
    spaceAccess({ roles: APP_DEPLOYMENT_LIST_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "list app deployments");
      }
    },
  )
  .get(
    "/spaces/:spaceId/app-deployments/:appDeploymentId",
    spaceAccess({ roles: APP_DEPLOYMENT_GET_ROLES }),
    async (c) => {
      try {
        c.req.param("appDeploymentId");
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "get app deployment");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollback",
    spaceAccess({ roles: APP_DEPLOYMENT_ROLLBACK_ROLES }),
    zValidator("json", rollbackSchema),
    async (c) => {
      try {
        c.req.param("appDeploymentId");
        c.req.valid("json");
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "rollback app deployment");
      }
    },
  )
  .get(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout",
    spaceAccess({ roles: APP_DEPLOYMENT_GET_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "get rollout state");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "pause rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "resume rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "abort rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async (_c) => {
      try {
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "promote rollout");
      }
    },
  )
  .delete(
    "/spaces/:spaceId/app-deployments/:appDeploymentId",
    spaceAccess({ roles: APP_DEPLOYMENT_REMOVE_ROLES }),
    async (c) => {
      try {
        c.req.param("appDeploymentId");
        throwRemovedAppDeployments();
      } catch (error) {
        handleRouteError(error, "remove app deployment");
      }
    },
  );

export default routes;
