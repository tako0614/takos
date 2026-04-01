import { Hono } from "hono";
import { z } from "zod";
import {
  GoneError,
  InternalError,
  NotFoundError,
  isAppError,
} from "takos-common/errors";
import {
  APP_DEPLOYMENTS_REMOVED_MESSAGE,
  AppDeploymentService,
} from "../../application/services/platform/app-deployments.ts";
import { getSpaceOperationPolicy } from "../../application/tools/tool-policy.ts";
import { logError } from "../../shared/utils/logger.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "./route-auth.ts";
import { zValidator } from "./zod-validator.ts";

function handleRouteError(error: unknown, context: string): never {
  if (isAppError(error)) throw error;
  logError(`${context} error`, error, { module: "routes/app-deployments" });
  throw new InternalError(`Failed to ${context}`);
}

function throwRemovedAppDeploymentRollout(): never {
  throw new GoneError(APP_DEPLOYMENTS_REMOVED_MESSAGE);
}

const repoRefSourceSchema = z.object({
  kind: z.literal("repo_ref"),
  repo_id: z.string().min(1),
  ref: z.string().min(1).optional(),
  ref_type: z.enum(["branch", "tag", "commit"]).optional(),
});

const packageReleaseSourceSchema = z.object({
  kind: z.literal("package_release"),
  owner: z.string().min(1),
  repo_name: z.string().min(1),
  version: z.string().min(1).optional(),
});

const createAppDeploymentSchema = z.object({
  group_name: z.string().min(1).optional(),
  env: z.string().min(1).optional(),
  provider: z.enum(["cloudflare", "local", "aws", "gcp", "k8s"]).optional(),
  source: z.discriminatedUnion("kind", [
    repoRefSourceSchema,
    packageReleaseSourceSchema,
  ]),
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
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const body = c.req.valid("json");
        const service = new AppDeploymentService(c.env);
        const result = await service.deploy(space.id, user.id, {
          groupName: body.group_name,
          providerName: body.provider,
          envName: body.env,
          approveOauthAutoEnv: body.approve_oauth_auto_env === true,
          approveSourceChange: body.approve_source_change === true,
          source: body.source.kind === "repo_ref"
            ? {
              kind: "repo_ref",
              repoId: body.source.repo_id,
              ref: body.source.ref,
              refType: body.source.ref_type,
            }
            : {
              kind: "package_release",
              owner: body.source.owner,
              repoName: body.source.repo_name,
              version: body.source.version,
            },
        });
        return c.json({
          app_deployment: result.appDeployment,
          apply_result: result.applyResult,
        }, 201);
      } catch (error) {
        handleRouteError(error, "deploy app");
      }
    },
  )
  .get(
    "/spaces/:spaceId/app-deployments",
    spaceAccess({ roles: APP_DEPLOYMENT_LIST_ROLES }),
    async (c) => {
      try {
        const service = new AppDeploymentService(c.env);
        const result = await service.list(c.get("access").space.id);
        return c.json({ app_deployments: result });
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
        const service = new AppDeploymentService(c.env);
        const result = await service.get(
          c.get("access").space.id,
          c.req.param("appDeploymentId"),
        );
        if (!result) throw new NotFoundError("App deployment");
        return c.json({ app_deployment: result });
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
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const body = c.req.valid("json");
        const result = await new AppDeploymentService(c.env).rollback(
          space.id,
          user.id,
          c.req.param("appDeploymentId"),
          { approveOauthAutoEnv: body.approve_oauth_auto_env === true },
        );
        return c.json({
          app_deployment: result.appDeployment,
          apply_result: result.applyResult,
        });
      } catch (error) {
        handleRouteError(error, "rollback app deployment");
      }
    },
  )
  .get(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout",
    spaceAccess({ roles: APP_DEPLOYMENT_GET_ROLES }),
    async () => {
      try {
        throwRemovedAppDeploymentRollout();
      } catch (error) {
        handleRouteError(error, "get rollout state");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async () => {
      try {
        throwRemovedAppDeploymentRollout();
      } catch (error) {
        handleRouteError(error, "pause rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async () => {
      try {
        throwRemovedAppDeploymentRollout();
      } catch (error) {
        handleRouteError(error, "resume rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async () => {
      try {
        throwRemovedAppDeploymentRollout();
      } catch (error) {
        handleRouteError(error, "abort rollout");
      }
    },
  )
  .post(
    "/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    async () => {
      try {
        throwRemovedAppDeploymentRollout();
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
        await new AppDeploymentService(c.env).remove(
          c.get("access").space.id,
          c.req.param("appDeploymentId"),
        );
        return c.json({ deleted: true });
      } catch (error) {
        handleRouteError(error, "remove app deployment");
      }
    },
  );

export default routes;
