import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { BadRequestError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import { DeploymentService } from "../../../application/services/deployment/index.ts";
import { parseDeploymentBackendConfig } from "../../../application/services/deployment/backend.ts";
import type { ArtifactKind } from "../../../application/services/deployment/models.ts";
import { DEPLOYMENT_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import {
  getServiceForUser,
  getServiceForUserWithRole,
} from "../../../application/services/platform/workers.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { NotFoundError } from "takos-common/errors";
import { MAX_BUNDLE_SIZE_BYTES } from "../../../shared/config/limits.ts";
import { stripPublicInternalFields } from "../response-utils.ts";
import {
  abortCanaryDeployment,
  promoteCanaryDeployment,
} from "../../../application/services/deployment/routing.ts";

type ApiDeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

type ApiDeploymentSummary = {
  id: string;
  version: number;
  status: "pending" | "in_progress" | "success" | "failed" | "rolled_back";
  deploy_state: string;
  artifact_ref: string | null;
  artifact_kind: ArtifactKind;
  routing_status: "active" | "canary" | "rollback" | "archived";
  routing_weight: number;
  bundle_hash: string | null;
  bundle_size: number | null;
  target: ReturnType<typeof parseDeploymentBackendConfig>;
  deployed_by: string | null;
  deploy_message: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  resolved_endpoint?: { kind: string; base_url: string } | null;
};

export const workersDeploymentsRouteDeps = {
  getServiceForUser,
  getServiceForUserWithRole,
  createDeploymentService: (env: AuthenticatedRouteEnv["Bindings"]) =>
    new DeploymentService(env),
  parseDeploymentBackendConfig,
  promoteCanaryDeployment,
  abortCanaryDeployment,
};

const targetSchema = z.object({
  route_ref: z.string().min(1).optional(),
  endpoint: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("service-ref"),
      ref: z.string().min(1),
    }).strict(),
    z.object({
      kind: z.literal("http-url"),
      base_url: z.string().url(),
    }).strict(),
  ]).optional(),
  artifact: z.object({
    kind: z.enum(["worker-bundle", "container-image"]).optional(),
    image_ref: z.string().min(1).optional(),
    exposed_port: z.number().int().positive().optional(),
    health_path: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

function extractResolvedEndpoint(
  stateJson: string,
): { kind: string; base_url: string } | null {
  const state = safeJsonParseOrDefault<Record<string, unknown>>(
    stateJson,
    {},
  );
  const ep = state.resolved_endpoint;
  if (ep && typeof ep === "object" && !Array.isArray(ep)) {
    const parsed = ep as Record<string, unknown>;
    if (typeof parsed.base_url === "string" && parsed.base_url.length > 0) {
      return {
        kind: String(parsed.kind ?? "http-url"),
        base_url: parsed.base_url,
      };
    }
  }
  return null;
}

function withoutDeploymentBackendFields<T>(
  deployment: T,
) {
  return stripPublicInternalFields(deployment);
}

const workersDeployments = new Hono<AuthenticatedRouteEnv>()
  .post(
    "/:id/deployments",
    zValidator(
      "json",
      z.object({
        bundle: z.string().optional(),
        deploy_message: z.string().optional(),
        strategy: z.enum(["direct", "canary"]).optional(),
        canary_weight: z.number().optional(),
        target: targetSchema.optional(),
      }).strict(),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");

      const worker = await workersDeploymentsRouteDeps
        .getServiceForUserWithRole(c.env.DB, workerId, user.id, [
          "owner",
          "admin",
          "editor",
        ]);
      if (!worker) {
        throw new NotFoundError("Service");
      }
      const serviceId = worker.id;

      const body = c.req.valid("json") as {
        bundle?: string;
        deploy_message?: string;
        strategy?: "direct" | "canary";
        canary_weight?: number;
        target?: z.infer<typeof targetSchema>;
      };

      const artifactKind: ArtifactKind = body.target?.artifact?.kind ??
        "worker-bundle";
      const isContainerDeploy = artifactKind === "container-image";

      if (isContainerDeploy) {
        if (!body.target?.artifact?.image_ref) {
          throw new BadRequestError(
            "artifact.image_ref is required for container-image deploys",
          );
        }
        if (body.strategy === "canary") {
          throw new BadRequestError(
            "canary strategy is not supported for container-image deploys",
          );
        }
      } else {
        if (
          !body.bundle || typeof body.bundle !== "string" ||
          body.bundle.trim().length === 0
        ) {
          throw new BadRequestError("bundle is required");
        }

        const bundleSizeBytes =
          new TextEncoder().encode(body.bundle).byteLength;
        if (bundleSizeBytes > MAX_BUNDLE_SIZE_BYTES) {
          throw new BadRequestError(
            `Bundle size (${
              Math.round(bundleSizeBytes / 1024 / 1024)
            }MB) exceeds maximum allowed size of 25MB`,
          );
        }
      }

      const strategy = body.strategy ?? "direct";

      const canaryWeight = typeof body.canary_weight === "number" &&
          Number.isFinite(body.canary_weight)
        ? Math.round(body.canary_weight)
        : undefined;
      const idempotencyKey = c.req.header("Idempotency-Key")?.trim() ||
        undefined;

      const deploymentService = workersDeploymentsRouteDeps
        .createDeploymentService(c.env);
      const deployment = await deploymentService.createDeployment({
        serviceId,
        spaceId: worker.space_id,
        userId: user.id,
        idempotencyKey,
        artifactKind,
        bundleContent: isContainerDeploy ? undefined : body.bundle,
        deployMessage: body.deploy_message,
        strategy,
        canaryWeight,
        target: body.target,
      });

      if (c.env.DEPLOY_QUEUE) {
        try {
          await c.env.DEPLOY_QUEUE.send({
            version: DEPLOYMENT_QUEUE_MESSAGE_VERSION,
            type: "deployment",
            deploymentId: deployment.id,
            timestamp: Date.now(),
          });
        } catch (error) {
          logWarn("Queue enqueue failed, falling back to inline execution", {
            module: "deployment",
            ...{
              deploymentId: deployment.id,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          if (c.executionCtx) {
            c.executionCtx.waitUntil(
              deploymentService.executeDeployment(deployment.id),
            );
          } else {
            await deploymentService.executeDeployment(deployment.id);
          }
        }
      } else {
        // Fallback for environments without queue binding
        c.executionCtx?.waitUntil(
          deploymentService.executeDeployment(deployment.id),
        );
      }

      return c.json({
        deployment: {
          id: deployment.id,
          version: deployment.version,
          status: deployment.status,
          deploy_state: deployment.deploy_state,
          artifact_kind: deployment.artifact_kind,
          target: workersDeploymentsRouteDeps.parseDeploymentBackendConfig(
            deployment,
          ),
          routing_status: deployment.routing_status,
          routing_weight: deployment.routing_weight,
          created_at: deployment.created_at,
        },
      }, 201);
    },
  )
  .get("/:id/deployments", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");
    const { limit } = parsePagination(c.req.query(), {
      limit: 20,
      maxLimit: 50,
    });

    const worker = await workersDeploymentsRouteDeps.getServiceForUser(
      c.env.DB,
      workerId,
      user.id,
    );
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const deploymentService = workersDeploymentsRouteDeps
      .createDeploymentService(c.env);
    const deployments = await deploymentService.getDeploymentHistory(
      workerId,
      limit,
    );

    const summaries: ApiDeploymentSummary[] = deployments.map((d) => {
      const summary: ApiDeploymentSummary = {
        id: d.id,
        version: d.version,
        status: d.status,
        deploy_state: d.deploy_state,
        artifact_ref: d.artifact_ref,
        artifact_kind: d.artifact_kind,
        routing_status: d.routing_status,
        routing_weight: d.routing_weight,
        bundle_hash: d.bundle_hash,
        bundle_size: d.bundle_size,
        target: workersDeploymentsRouteDeps.parseDeploymentBackendConfig(d),
        deployed_by: d.deployed_by,
        deploy_message: d.deploy_message,
        created_at: d.created_at,
        completed_at: d.completed_at,
        error_message: d.step_error,
      };
      if (d.artifact_kind === "container-image") {
        summary.resolved_endpoint = extractResolvedEndpoint(
          d.backend_state_json,
        );
      }
      return summary;
    });

    return c.json({ deployments: summaries });
  })
  .post(
    "/:id/deployments/rollback",
    zValidator(
      "json",
      z.object({
        target_version: z.number().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");

      const worker = await workersDeploymentsRouteDeps
        .getServiceForUserWithRole(c.env.DB, workerId, user.id, [
          "owner",
          "admin",
          "editor",
        ]);
      if (!worker) {
        throw new NotFoundError("Service");
      }

      const body = c.req.valid("json");
      const targetVersion = typeof body?.target_version === "number" &&
          Number.isFinite(body.target_version)
        ? Math.floor(body.target_version)
        : undefined;

      const deploymentService = workersDeploymentsRouteDeps
        .createDeploymentService(c.env);

      const deployment = await deploymentService.rollback({
        serviceId: worker.id,
        userId: user.id,
        targetVersion,
      });
      return c.json({
        success: true,
        deployment: {
          id: deployment.id,
          version: deployment.version,
          artifact_kind: deployment.artifact_kind,
          target: workersDeploymentsRouteDeps.parseDeploymentBackendConfig(
            deployment,
          ),
          routing_status: deployment.routing_status,
          routing_weight: deployment.routing_weight,
        },
      });
    },
  )
  .get("/:id/deployments/:deploymentId", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");
    const deploymentId = c.req.param("deploymentId");

    const worker = await workersDeploymentsRouteDeps.getServiceForUser(
      c.env.DB,
      workerId,
      user.id,
    );
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const deploymentService = workersDeploymentsRouteDeps
      .createDeploymentService(c.env);
    const deployment = await deploymentService.getDeploymentById(deploymentId);
    if (!deployment || deployment.service_id !== workerId) {
      throw new NotFoundError("Deployment");
    }

    const events = await deploymentService.getDeploymentEvents(deploymentId);
    const apiEvents: ApiDeploymentEvent[] = events.map((e) => ({
      id: String(e.id),
      type: e.event_type,
      message: e.message || "",
      created_at: e.created_at,
    }));

    let maskedEnvVars: Record<string, string> = {};
    try {
      maskedEnvVars = await deploymentService.getMaskedEnvVars(deployment);
    } catch (err) {
      logWarn("Failed to decrypt env vars for deployment", {
        module: "deployment",
        details: [deploymentId, err],
      });
    }

    let bindings: WorkerBinding[] = [];
    try {
      bindings = await deploymentService.getBindings(deployment);
    } catch (err) {
      logWarn("Failed to decrypt bindings for deployment", {
        module: "deployment",
        details: [deploymentId, err],
      });
    }

    const sanitizedBindings = bindings.map((b) => {
      if (b.type === "secret_text") {
        return { ...b, text: "********" };
      }
      return b;
    });

    const resolvedEndpoint = deployment.artifact_kind === "container-image"
      ? extractResolvedEndpoint(deployment.backend_state_json)
      : null;

    return c.json({
      deployment: {
        ...withoutDeploymentBackendFields(deployment),
        target: workersDeploymentsRouteDeps.parseDeploymentBackendConfig(
          deployment,
        ),
        error_message: deployment.step_error,
        env_vars_masked: maskedEnvVars,
        bindings: sanitizedBindings,
        ...(resolvedEndpoint ? { resolved_endpoint: resolvedEndpoint } : {}),
      },
      events: apiEvents,
    });
  })
  .post("/:id/deployments/:deploymentId/promote", async (c) => {
    const user = c.get("user");
    const serviceId = c.req.param("id");
    const deploymentId = c.req.param("deploymentId");

    const worker = await workersDeploymentsRouteDeps.getServiceForUserWithRole(
      c.env.DB,
      serviceId,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const result = await workersDeploymentsRouteDeps.promoteCanaryDeployment(
      c.env,
      {
        serviceId: worker.id,
        deploymentId,
        userId: user.id,
      },
    );

    return c.json({
      deployment_id: result.deploymentId,
      status: "promoted",
      weight: 100,
    });
  })
  .post("/:id/deployments/:deploymentId/abort", async (c) => {
    const user = c.get("user");
    const serviceId = c.req.param("id");
    const deploymentId = c.req.param("deploymentId");

    const worker = await workersDeploymentsRouteDeps.getServiceForUserWithRole(
      c.env.DB,
      serviceId,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const result = await workersDeploymentsRouteDeps.abortCanaryDeployment(
      c.env,
      {
        serviceId: worker.id,
        deploymentId,
        userId: user.id,
      },
    );

    return c.json({
      deployment_id: result.deploymentId,
      status: "aborted",
      rolled_back_to: result.rolledBackTo,
    });
  });

export default workersDeployments;
