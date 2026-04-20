import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  countServicesInSpace,
  createService,
  getServiceForUser,
  getServiceForUserWithRole,
  listServicesForSpace,
  listServicesForUser,
  WORKSPACE_SERVICE_LIMITS,
} from "../../../application/services/platform/workers.ts";
import { ServiceDesiredStateService } from "../../../application/services/platform/worker-desired-state.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { services } from "../../../infra/db/schema.ts";
import { createCloudflareApiClient } from "../../../platform/backends/cloudflare/api-client.ts";
import { InternalError, NotFoundError } from "takos-common/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { requireSpaceAccess } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import { deleteServiceWithCleanup } from "./delete-cleanup.ts";
import {
  resolveCreateSpaceId,
  resolveGroupIdForSpace,
} from "./group-validation.ts";

/** Shape of a single invocation record from the Cloudflare GraphQL Analytics API */
interface CfInvocationRecord {
  datetime: string;
  status: string;
  cpuTime: number;
  responseStatus: number;
  clientRequestMethod: string;
  clientRequestPath: string;
}

/** Response shape from the Cloudflare GraphQL Analytics API */
interface CfGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: CfInvocationRecord[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const workersBase = new Hono<AuthenticatedRouteEnv>()
  .get("/", async (c) => {
    const user = c.get("user");

    const workersList = await listServicesForUser(c.env.DB, user.id);

    return c.json({ services: workersList });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        space_id: z.string().optional(),
        group_id: z.string().optional(),
        service_type: z.enum(["app", "service"]).optional(),
        slug: z.string().optional(),
        config: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const serviceType = body.service_type || "app";

      const resolvedSpaceId = await resolveCreateSpaceId(
        c,
        user.id,
        body.space_id,
      );
      const groupResolution = await resolveGroupIdForSpace(c, {
        groupId: body.group_id,
        spaceId: resolvedSpaceId,
        errorMessage: "group_id must belong to the selected workspace",
      });
      if (groupResolution.response) {
        return groupResolution.response;
      }

      const currentCount = await countServicesInSpace(
        c.env.DB,
        resolvedSpaceId,
      );
      if (currentCount >= WORKSPACE_SERVICE_LIMITS.maxServices) {
        return c.json({
          error:
            `Space has reached the maximum number of services (${WORKSPACE_SERVICE_LIMITS.maxServices})`,
        }, 429);
      }

      const result = await createService(c.env.DB, {
        spaceId: resolvedSpaceId,
        groupId: groupResolution.groupId,
        workerType: serviceType,
        slug: body.slug,
        config: body.config || null,
        platformDomain: c.env.TENANT_BASE_DOMAIN,
      });
      if (!result.service) {
        throw new InternalError("Failed to create service");
      }

      return c.json({ service: result.service }, 201);
    },
  )
  .get("/:id", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await getServiceForUser(c.env.DB, workerId, user.id);
    if (!worker) {
      throw new NotFoundError("Service");
    }

    return c.json({ service: worker });
  })
  .patch(
    "/:id/group",
    zValidator(
      "json",
      z.object({
        group_id: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json") as { group_id?: string | null };

      const worker = await getServiceForUserWithRole(
        c.env.DB,
        workerId,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!worker) {
        throw new NotFoundError("Service");
      }

      const groupResolution = await resolveGroupIdForSpace(c, {
        groupId: body.group_id,
        spaceId: worker.space_id,
        errorMessage:
          "group_id must belong to the same workspace as the service",
      });
      if (groupResolution.response) {
        return groupResolution.response;
      }

      const db = getDb(c.env.DB);
      await db.update(services)
        .set({
          groupId: groupResolution.groupId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(services.id, worker.id))
        .run();

      const updated = await getServiceForUser(c.env.DB, workerId, user.id);
      return c.json({ service: updated });
    },
  )
  .get("/:id/logs", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");
    const { limit } = parsePagination(c.req.query());
    const sinceRaw = Number.parseInt(c.req.query("since") ?? "", 10);
    const sinceHours = Number.isFinite(sinceRaw) && sinceRaw > 0
      ? Math.min(sinceRaw, 72)
      : 1;

    if (!c.env.CF_ACCOUNT_ID || !c.env.CF_API_TOKEN) {
      throw new InternalError("Cloudflare API not configured");
    }

    const worker = await getServiceForUser(c.env.DB, workerId, user.id);
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const desiredState = new ServiceDesiredStateService(c.env);
    const scriptName = await desiredState.getCurrentDeploymentArtifactRef(
      worker.id,
    );

    if (!scriptName) {
      return c.json({ invocations: [] });
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - sinceHours * 60 * 60 * 1000);

    const query = `
    query GetWorkerInvocations($accountTag: String!, $scriptName: String!, $startTime: Time!, $endTime: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            filter: {
              scriptName: $scriptName
              datetime_geq: $startTime
              datetime_leq: $endTime
            }
            limit: $limit
            orderBy: [datetime_DESC]
          ) {
            datetime
            status
            cpuTime
            responseStatus
            clientRequestMethod
            clientRequestPath
          }
        }
      }
    }
  `;

    const cfClient = createCloudflareApiClient(c.env);
    if (!cfClient) {
      throw new InternalError("Cloudflare API not configured");
    }

    const gqlResponse = await cfClient.fetchRaw("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: c.env.CF_ACCOUNT_ID,
          scriptName,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          limit,
        },
      }),
    });

    const result = await gqlResponse.json() as CfGraphQLResponse;

    if (result.errors?.length) {
      throw new InternalError(result.errors[0].message);
    }

    const invocations =
      result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    return c.json({ invocations });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await getServiceForUserWithRole(
      c.env.DB,
      workerId,
      user.id,
      ["owner", "admin"],
    );
    if (!worker) {
      throw new NotFoundError("Service");
    }

    await deleteServiceWithCleanup(c, worker);

    return c.json({ success: true });
  });

export const workersSpaceRoutes = new Hono<AuthenticatedRouteEnv>()
  .get("/:spaceId/services", async (c) => {
    const user = c.get("user");
    const spaceId = c.req.param("spaceId");

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const workersList = await listServicesForSpace(c.env.DB, access.space.id);

    return c.json({ services: workersList });
  });

export default workersBase;
