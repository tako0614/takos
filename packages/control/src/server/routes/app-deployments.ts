import { Hono } from "hono";
import { z } from "zod";
import {
  BadRequestError,
  InternalError,
  isAppError,
  NotFoundError,
} from "takos-common/errors";
import { AppDeploymentService } from "../../application/services/platform/app-deployments.ts";
import { parseAppManifestYaml } from "../../application/services/source/app-manifest-parser/index.ts";
import { getSpaceOperationPolicy } from "../../application/tools/tool-policy.ts";
import { logError } from "../../shared/utils/logger.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "./route-auth.ts";
import { zValidator } from "./zod-validator.ts";

function handleRouteError(error: unknown, context: string): never {
  if (isAppError(error)) throw error;
  logError(`${context} error`, error, { module: "routes/app-deployments" });
  throw new InternalError(`Failed to ${context}`);
}

const gitRefSourceSchema = z.object({
  kind: z.literal("git_ref"),
  repository_url: z.string().url(),
  ref: z.string().min(1).optional(),
  ref_type: z.enum(["branch", "tag", "commit"]).optional(),
});

const manifestSourceSchema = z.object({
  kind: z.literal("manifest"),
  manifest: z.record(z.string(), z.unknown()),
  artifacts: z.array(z.record(z.string(), z.unknown())).optional(),
});

const sourceSchema = z.discriminatedUnion("kind", [
  gitRefSourceSchema,
  manifestSourceSchema,
]);

const createAppDeploymentSchema = z.object({
  group_name: z.string().min(1).optional(),
  env: z.string().min(1).optional(),
  provider: z.enum(["cloudflare", "local", "aws", "gcp", "k8s"]).optional(),
  source: sourceSchema,
});

const rollbackSchema = z.object({});

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
    "/spaces/:spaceId/app-deployments/plan",
    spaceAccess({ roles: APP_DEPLOYMENT_DEPLOY_ROLES }),
    zValidator("json", createAppDeploymentSchema),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const body = c.req.valid("json");
        const service = new AppDeploymentService(c.env);
        if (body.source.kind === "manifest") {
          let manifest;
          try {
            manifest = parseAppManifestYaml(
              JSON.stringify(body.source.manifest),
            );
          } catch (parseError) {
            throw new BadRequestError(
              parseError instanceof Error
                ? parseError.message
                : "Invalid app manifest",
            );
          }
          const result = await service.planFromManifest(space.id, user.id, {
            manifest,
            groupName: body.group_name,
            providerName: body.provider,
            envName: body.env,
          });
          return c.json(result);
        }
        const result = await service.plan(space.id, user.id, {
          source: {
            kind: "git_ref",
            repositoryUrl: body.source.repository_url,
            ref: body.source.ref,
            refType: body.source.ref_type,
          },
          groupName: body.group_name,
          providerName: body.provider,
          envName: body.env,
        });
        return c.json(result);
      } catch (error) {
        handleRouteError(error, "plan app deployment");
      }
    },
  )
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
        if (body.source.kind === "manifest") {
          let manifest;
          try {
            // Re-run the canonical YAML/flat-schema parser so the incoming
            // object receives the same validation as repo-sourced manifests.
            manifest = parseAppManifestYaml(
              JSON.stringify(body.source.manifest),
            );
          } catch (parseError) {
            throw new BadRequestError(
              parseError instanceof Error
                ? parseError.message
                : "Invalid app manifest",
            );
          }
          const result = await service.deployFromManifest(
            space.id,
            user.id,
            {
              manifest,
              artifacts: body.source.artifacts,
              groupName: body.group_name,
              providerName: body.provider,
              envName: body.env,
            },
          );
          return c.json({
            app_deployment: result.appDeployment,
            apply_result: result.applyResult,
          }, 201);
        }
        const result = await service.deploy(space.id, user.id, {
          groupName: body.group_name,
          providerName: body.provider,
          envName: body.env,
          source: {
            kind: "git_ref",
            repositoryUrl: body.source.repository_url,
            ref: body.source.ref,
            refType: body.source.ref_type,
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
        const result = await new AppDeploymentService(c.env).rollback(
          space.id,
          user.id,
          c.req.param("appDeploymentId"),
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
