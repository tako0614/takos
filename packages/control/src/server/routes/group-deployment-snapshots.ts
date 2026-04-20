import { Hono } from "hono";
import { z } from "zod";
import {
  BadRequestError,
  InternalError,
  isAppError,
  NotFoundError,
} from "takos-common/errors";
import { GroupDeploymentSnapshotService } from "../../application/services/platform/group-deployment-snapshots.ts";
import { parseAppManifestYaml } from "../../application/services/source/app-manifest-parser/index.ts";
import { getSpaceOperationPolicy } from "../../application/tools/tool-policy.ts";
import { logError } from "../../shared/utils/logger.ts";
import type { TranslationReport } from "../../application/services/deployment/translation-report.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "./route-auth.ts";
import {
  hasPublicInternalField,
  stripPublicInternalFields,
} from "./response-utils.ts";
import { zValidator } from "./zod-validator.ts";

function handleRouteError(error: unknown, context: string): never {
  if (isAppError(error)) throw error;
  logError(`${context} error`, error, {
    module: "routes/group-deployment-snapshots",
  });
  throw new InternalError(`Failed to ${context}`);
}

const gitRefSourceSchema = z.object({
  kind: z.literal("git_ref"),
  repository_url: z.string().url(),
  ref: z.string().min(1).optional(),
  ref_type: z.enum(["branch", "tag", "commit"]).optional(),
}).strict();

const manifestSourceSchema = z.object({
  kind: z.literal("manifest"),
  manifest: z.record(z.string(), z.unknown()).refine(
    (manifest) => !hasPublicInternalField(manifest),
    { message: "manifest must not contain backend fields" },
  ),
  artifacts: z.array(
    z.record(z.string(), z.unknown()).refine(
      (artifact) => !hasPublicInternalField(artifact),
      { message: "artifacts must not contain backend fields" },
    ),
  ).optional(),
}).strict();

const sourceSchema = z.discriminatedUnion("kind", [
  gitRefSourceSchema,
  manifestSourceSchema,
]);

const createGroupDeploymentSnapshotSchema = z.object({
  group_name: z.string().min(1),
  env: z.string().min(1).optional(),
  target: z.array(z.string().min(1)).optional(),
  source: sourceSchema,
}).strict();

const rollbackSchema = z.object({}).strict();

const DEPLOYMENT_SNAPSHOT_LIST_ROLES =
  getSpaceOperationPolicy("group_deployment_snapshot.list").allowed_roles;
const DEPLOYMENT_SNAPSHOT_GET_ROLES =
  getSpaceOperationPolicy("group_deployment_snapshot.get").allowed_roles;
const DEPLOYMENT_SNAPSHOT_DEPLOY_ROLES =
  getSpaceOperationPolicy("group_deployment_snapshot.deploy_from_repo")
    .allowed_roles;
const DEPLOYMENT_SNAPSHOT_ROLLBACK_ROLES =
  getSpaceOperationPolicy("group_deployment_snapshot.rollback").allowed_roles;
const DEPLOYMENT_SNAPSHOT_REMOVE_ROLES =
  getSpaceOperationPolicy("group_deployment_snapshot.remove").allowed_roles;

function toApiTranslationReport(report: TranslationReport): TranslationReport {
  return stripPublicInternalFields(report);
}

function toApiResult<T extends { translationReport: TranslationReport }>(
  result: T,
): T {
  return {
    ...result,
    translationReport: toApiTranslationReport(result.translationReport),
  };
}

function toApiGroupDeploymentSnapshot<T>(
  deployment: T,
): T extends Record<string, unknown> ? Record<string, unknown> : T {
  const stripped = stripPublicInternalFields(deployment);
  if (!stripped || typeof stripped !== "object" || Array.isArray(stripped)) {
    return stripped as T extends Record<string, unknown>
      ? Record<string, unknown>
      : T;
  }
  return stripped as T extends Record<string, unknown> ? Record<string, unknown>
    : T;
}

const routes = new Hono<SpaceAccessRouteEnv>()
  .post(
    "/spaces/:spaceId/group-deployment-snapshots/plan",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_DEPLOY_ROLES }),
    zValidator("json", createGroupDeploymentSnapshotSchema),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const body = c.req.valid("json");
        const service = new GroupDeploymentSnapshotService(c.env);
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
                : "Invalid deploy manifest",
            );
          }
          const result = await service.planFromManifest(space.id, user.id, {
            manifest,
            groupName: body.group_name,
            envName: body.env,
            targets: body.target,
          });
          return c.json(toApiResult(result));
        }
        const result = await service.plan(space.id, user.id, {
          source: {
            kind: "git_ref",
            repositoryUrl: body.source.repository_url,
            ref: body.source.ref,
            refType: body.source.ref_type,
          },
          groupName: body.group_name,
          envName: body.env,
          targets: body.target,
        });
        return c.json(toApiResult(result));
      } catch (error) {
        handleRouteError(error, "plan group deployment snapshot");
      }
    },
  )
  .post(
    "/spaces/:spaceId/group-deployment-snapshots",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_DEPLOY_ROLES }),
    zValidator("json", createGroupDeploymentSnapshotSchema),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const body = c.req.valid("json");
        const service = new GroupDeploymentSnapshotService(c.env);
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
                : "Invalid deploy manifest",
            );
          }
          const result = await service.deployFromManifest(
            space.id,
            user.id,
            {
              manifest,
              artifacts: body.source.artifacts,
              groupName: body.group_name,
              envName: body.env,
              targets: body.target,
            },
          );
          return c.json({
            group_deployment_snapshot: toApiGroupDeploymentSnapshot(
              result.groupDeploymentSnapshot,
            ),
            apply_result: toApiResult(result.applyResult),
          }, 201);
        }
        const result = await service.deploy(space.id, user.id, {
          groupName: body.group_name,
          envName: body.env,
          targets: body.target,
          source: {
            kind: "git_ref",
            repositoryUrl: body.source.repository_url,
            ref: body.source.ref,
            refType: body.source.ref_type,
          },
        });
        return c.json({
          group_deployment_snapshot: toApiGroupDeploymentSnapshot(
            result.groupDeploymentSnapshot,
          ),
          apply_result: toApiResult(result.applyResult),
        }, 201);
      } catch (error) {
        handleRouteError(error, "deploy app");
      }
    },
  )
  .get(
    "/spaces/:spaceId/group-deployment-snapshots",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_LIST_ROLES }),
    async (c) => {
      try {
        const service = new GroupDeploymentSnapshotService(c.env);
        const result = await service.list(c.get("access").space.id);
        return c.json({
          group_deployment_snapshots: result.map((deployment) =>
            toApiGroupDeploymentSnapshot(deployment)
          ),
        });
      } catch (error) {
        handleRouteError(error, "list group deployment snapshots");
      }
    },
  )
  .get(
    "/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_GET_ROLES }),
    async (c) => {
      try {
        const service = new GroupDeploymentSnapshotService(c.env);
        const result = await service.get(
          c.get("access").space.id,
          c.req.param("groupDeploymentSnapshotId"),
        );
        if (!result) throw new NotFoundError("Group deployment snapshot");
        return c.json({
          group_deployment_snapshot: toApiGroupDeploymentSnapshot(result),
        });
      } catch (error) {
        handleRouteError(error, "get group deployment snapshot");
      }
    },
  )
  .post(
    "/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId/rollback",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_ROLLBACK_ROLES }),
    zValidator("json", rollbackSchema),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      try {
        const result = await new GroupDeploymentSnapshotService(c.env).rollback(
          space.id,
          user.id,
          c.req.param("groupDeploymentSnapshotId"),
        );
        return c.json({
          group_deployment_snapshot: toApiGroupDeploymentSnapshot(
            result.groupDeploymentSnapshot,
          ),
          apply_result: toApiResult(result.applyResult),
        });
      } catch (error) {
        handleRouteError(error, "rollback group deployment snapshot");
      }
    },
  )
  .delete(
    "/spaces/:spaceId/group-deployment-snapshots/:groupDeploymentSnapshotId",
    spaceAccess({ roles: DEPLOYMENT_SNAPSHOT_REMOVE_ROLES }),
    async (c) => {
      try {
        await new GroupDeploymentSnapshotService(c.env).remove(
          c.get("access").space.id,
          c.req.param("groupDeploymentSnapshotId"),
        );
        return c.json({ deleted: true });
      } catch (error) {
        handleRouteError(error, "remove group deployment snapshot");
      }
    },
  );

export default routes;
