import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
  spaceAccess,
} from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  createWorkspaceWithDefaultRepo,
  deleteWorkspace,
  getOrCreatePersonalWorkspace,
  getWorkspaceModelSettings,
  getWorkspaceWithRepository,
  listWorkspacesForUser,
  updateWorkspace,
  updateWorkspaceModel,
} from "../../../application/services/identity/spaces.ts";
import {
  DEFAULT_MODEL_ID,
  getModelBackend as getModelBackendForModel,
  normalizeModelId,
  resolveHistoryTokenBudget,
} from "../../../application/services/agent/index.ts";
import { getUISidebarItems } from "../../../application/services/platform/ui-extensions.ts";
import { toWorkspaceResponse } from "../../../application/services/identity/response-formatters.ts";
import { processDefaultAppPreinstallJobs } from "../../../application/services/source/default-app-distribution.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import {
  repositories,
  resourceAccess,
  resources,
  threads,
} from "../../../infra/db/schema.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import { logWarn } from "../../../shared/utils/logger.ts";

const VALID_SECURITY_POSTURES = ["standard", "restricted_egress"] as const;
const VALID_MODEL_BACKENDS = ["openai", "anthropic", "google"] as const;
type ModelBackend = typeof VALID_MODEL_BACKENDS[number];

function normalizeModelBackendInput(
  modelBackend?: string | null,
): ModelBackend | null {
  if (!modelBackend) return null;
  const normalized = modelBackend.toLowerCase().trim() as ModelBackend;
  return VALID_MODEL_BACKENDS.includes(normalized) ? normalized : null;
}

function resolveModelBackendAlias(
  primary?: string | null,
  alias?: string | null,
): string | undefined {
  if (!primary) return alias ?? undefined;
  if (!alias) return primary;
  return primary.trim().toLowerCase() === alias.trim().toLowerCase()
    ? primary
    : "__conflicting_model_backend__";
}

export const spacesRouteDeps = {
  listWorkspacesForUser,
  getOrCreatePersonalWorkspace,
  createWorkspaceWithDefaultRepo,
  getWorkspaceWithRepository,
  getWorkspaceModelSettings,
  updateWorkspace,
  updateWorkspaceModel,
  deleteWorkspace,
  processDefaultAppPreinstallJobs,
};

export default new Hono<AuthenticatedRouteEnv>()
  .get("/", async (c) => {
    const user = c.get("user");

    let workspaces = await spacesRouteDeps.listWorkspacesForUser(
      c.env,
      user.id,
    );

    if (!workspaces.some((workspace) => workspace.kind === "user")) {
      const personalWorkspace = await spacesRouteDeps
        .getOrCreatePersonalWorkspace(c.env, user.id);
      if (personalWorkspace) {
        workspaces = [
          personalWorkspace,
          ...workspaces.filter((workspace) =>
            workspace.id !== personalWorkspace.id
          ),
        ];
      }
    }

    return c.json({ spaces: workspaces.map(toWorkspaceResponse) });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string(),
        id: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");

      if (!body.name || body.name.trim().length === 0) {
        throw new BadRequestError("Name is required");
      }

      try {
        const { workspace, repository } = await spacesRouteDeps
          .createWorkspaceWithDefaultRepo(
            c.env,
            user.id,
            body.name.trim(),
            { id: body.id },
          );
        c.executionCtx?.waitUntil(
          spacesRouteDeps.processDefaultAppPreinstallJobs(c.env, {
            limit: 3,
            spaceId: workspace.id,
          }).catch((error) => {
            logWarn("Default app preinstall background tick failed", {
              module: "routes/spaces",
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        );

        return c.json(
          { space: toWorkspaceResponse(workspace), repository },
          201,
        );
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : "Failed to create space";
        throw new BadRequestError(message);
      }
    },
  )
  .get("/me", async (c) => {
    const user = c.get("user");
    if (!await spacesRouteDeps.getOrCreatePersonalWorkspace(c.env, user.id)) {
      throw new NotFoundError("Personal space");
    }

    const access = await requireSpaceAccess(c, "me", user.id);

    const { workspace, repository } = await spacesRouteDeps
      .getWorkspaceWithRepository(c.env, access.space);

    return c.json({
      space: toWorkspaceResponse(workspace),
      role: access.membership.role,
      repository,
    });
  })
  .get("/:spaceId", spaceAccess(), async (c) => {
    const { space, membership } = c.get("access");

    const { workspace, repository } = await spacesRouteDeps
      .getWorkspaceWithRepository(
        c.env,
        space,
      );

    return c.json({
      space: toWorkspaceResponse(workspace),
      role: membership.role,
      repository,
    });
  })
  .get("/:spaceId/export", spaceAccess(), async (c) => {
    const user = c.get("user");
    const { space } = c.get("access");

    const db = getDb(c.env.DB);

    const accessibleResourceIds = await db.select({
      resourceId: resourceAccess.resourceId,
      permission: resourceAccess.permission,
    })
      .from(resourceAccess)
      .where(eq(resourceAccess.accountId, space.id))
      .all();
    const accessibleIdSet = new Set(
      accessibleResourceIds.map((r) => r.resourceId),
    );
    const accessPermissionMap = new Map(
      accessibleResourceIds.map((r) => [r.resourceId, r.permission]),
    );

    const [repoRows, threadRows, resourceRows] = await Promise.all([
      db.select({
        id: repositories.id,
        name: repositories.name,
        updatedAt: repositories.updatedAt,
      })
        .from(repositories)
        .where(eq(repositories.accountId, space.id))
        .orderBy(desc(repositories.updatedAt))
        .all(),
      db.select({
        id: threads.id,
        title: threads.title,
        status: threads.status,
        updatedAt: threads.updatedAt,
      })
        .from(threads)
        .where(and(
          eq(threads.accountId, space.id),
          ne(threads.status, "deleted"),
        ))
        .orderBy(desc(threads.updatedAt))
        .all(),
      db.select({
        id: resources.id,
        name: resources.name,
        type: resources.type,
        ownerAccountId: resources.ownerAccountId,
        updatedAt: resources.updatedAt,
      }).from(resources).where(
        and(
          inArray(resources.type, ["d1", "r2"]),
          ne(resources.status, "deleted"),
          or(
            and(
              eq(resources.accountId, space.id),
              eq(resources.ownerAccountId, user.id),
            ),
            accessibleIdSet.size > 0
              ? inArray(resources.id, Array.from(accessibleIdSet))
              : undefined,
          ),
        ),
      ).orderBy(desc(resources.updatedAt)).all(),
    ]);

    const exportedAt = new Date().toISOString();

    const d1Resources = resourceRows
      .filter((resource) => resource.type === "d1")
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        updated_at: resource.updatedAt,
        access_level: resource.ownerAccountId === user.id
          ? "owner"
          : (accessPermissionMap.get(resource.id) || "read"),
        export_url: `/api/resources/${resource.id}/d1/export`,
        method: "POST" as const,
      }));

    const r2Resources = resourceRows
      .filter((resource) => resource.type === "r2")
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        updated_at: resource.updatedAt,
        access_level: resource.ownerAccountId === user.id
          ? "owner"
          : (accessPermissionMap.get(resource.id) || "read"),
      }));

    return c.json({
      space: toWorkspaceResponse(space),
      exported_at: exportedAt,
      repositories: repoRows.map((repo) => ({
        id: repo.id,
        name: repo.name,
        updated_at: repo.updatedAt,
        export_url: `/api/repos/${repo.id}/export`,
        method: "GET" as const,
      })),
      threads: threadRows.map((thread) => ({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        updated_at: thread.updatedAt,
        export_url: `/api/threads/${thread.id}/export`,
        method: "GET" as const,
        formats: ["markdown", "json", "pdf"] as const,
      })),
      resources: {
        d1: d1Resources,
        r2: r2Resources,
      },
      counts: {
        repositories: repoRows.length,
        threads: threadRows.length,
        d1_resources: d1Resources.length,
        r2_resources: r2Resources.length,
        total_resources: d1Resources.length + r2Resources.length,
      },
    });
  })
  .patch(
    "/:spaceId",
    spaceAccess({
      roles: ["owner", "admin"],
      message: "Space not found or insufficient permissions",
    }),
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        ai_model: z.string().optional(),
        ai_provider: z.string().optional(),
        model_backend: z.string().optional(),
        security_posture: z.enum(VALID_SECURITY_POSTURES).optional(),
      }).strict(),
    ),
    async (c) => {
      const { space } = c.get("access");
      const body = c.req.valid("json");
      const modelBackend = resolveModelBackendAlias(
        body.model_backend,
        body.ai_provider,
      );

      const updates: {
        name?: string;
        ai_model?: string;
        model_backend?: string;
        security_posture?: "standard" | "restricted_egress";
      } = {};

      if (body.name && body.name.trim().length > 0) {
        updates.name = body.name.trim();
      }

      if (body.ai_model) {
        const normalizedModel = normalizeModelId(body.ai_model);
        if (!normalizedModel) {
          throw new BadRequestError("Invalid model");
        }
        updates.ai_model = normalizedModel;

        const inferredModelBackend = getModelBackendForModel(normalizedModel);
        const modelBackendOverride = normalizeModelBackendInput(
          modelBackend,
        );
        if (modelBackend && !modelBackendOverride) {
          throw new BadRequestError("Invalid model backend");
        }
        if (
          modelBackendOverride && modelBackendOverride !== inferredModelBackend
        ) {
          throw new BadRequestError("Model backend does not match model");
        }
        updates.model_backend = modelBackendOverride || inferredModelBackend;
      }

      if (modelBackend) {
        const normalizedModelBackend = normalizeModelBackendInput(
          modelBackend,
        );
        if (!normalizedModelBackend) {
          throw new BadRequestError("Invalid model backend");
        }
        if (!body.ai_model) {
          const existingModel = normalizeModelId(space.ai_model) ||
            DEFAULT_MODEL_ID;
          const inferredModelBackend = getModelBackendForModel(existingModel);
          if (normalizedModelBackend !== inferredModelBackend) {
            throw new BadRequestError("Model backend does not match model");
          }
        }
        updates.model_backend = normalizedModelBackend;
      }

      if (body.security_posture) {
        updates.security_posture = body.security_posture;
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError("No valid updates provided");
      }

      const workspace = await spacesRouteDeps.updateWorkspace(
        c.env.DB,
        space.id,
        updates,
      );
      if (!workspace) {
        throw new BadRequestError("No valid updates provided");
      }

      return c.json({ space: toWorkspaceResponse(workspace) });
    },
  )
  .get("/:spaceId/model", spaceAccess(), async (c) => {
    const { space } = c.get("access");

    const workspace = await spacesRouteDeps.getWorkspaceModelSettings(
      c.env.DB,
      space.id,
    );

    const model = normalizeModelId(workspace?.ai_model) || DEFAULT_MODEL_ID;
    const inferredModelBackend = getModelBackendForModel(model);
    const storedModelBackend = workspace?.model_backend;
    const modelBackend = storedModelBackend === inferredModelBackend
      ? storedModelBackend
      : inferredModelBackend;

    return c.json({
      ai_model: model,
      model,
      model_backend: modelBackend,
      token_limit: resolveHistoryTokenBudget(
        model,
        c.env.MODEL_CONTEXT_WINDOWS,
      ),
    });
  })
  .patch(
    "/:spaceId/model",
    spaceAccess({
      roles: ["owner", "admin"],
      message: "Space not found or insufficient permissions",
    }),
    zValidator(
      "json",
      z.object({
        model: z.string().optional(),
        ai_model: z.string().optional(),
        provider: z.string().optional(),
        model_backend: z.string().optional(),
      }).strict(),
    ),
    async (c) => {
      const { space } = c.get("access");
      const body = c.req.valid("json");

      const requestedModel = body.model || body.ai_model;
      const requestedModelBackend = resolveModelBackendAlias(
        body.model_backend,
        body.provider,
      );

      if (!requestedModel) {
        throw new BadRequestError("Model is required");
      }

      const model = normalizeModelId(requestedModel);
      if (!model) {
        throw new BadRequestError("Invalid model");
      }

      const inferredModelBackend = getModelBackendForModel(model);
      const modelBackendInput = requestedModelBackend
        ? normalizeModelBackendInput(requestedModelBackend)
        : null;
      if (requestedModelBackend && !modelBackendInput) {
        throw new BadRequestError("Invalid model backend");
      }
      const modelBackend = modelBackendInput || inferredModelBackend;
      if (modelBackend !== inferredModelBackend) {
        throw new BadRequestError("Model backend does not match model");
      }

      await spacesRouteDeps.updateWorkspaceModel(
        c.env.DB,
        space.id,
        model,
        modelBackend,
      );

      return c.json({
        ai_model: model,
        model,
        model_backend: modelBackend,
        token_limit: resolveHistoryTokenBudget(
          model,
          c.env.MODEL_CONTEXT_WINDOWS,
        ),
      });
    },
  )
  .delete(
    "/:spaceId",
    spaceAccess({
      roles: ["owner"],
      message: "Space not found or insufficient permissions",
    }),
    async (c) => {
      const { space } = c.get("access");

      await spacesRouteDeps.deleteWorkspace(c.env.DB, space.id);

      return c.json({ success: true });
    },
  )
  .get("/:spaceId/sidebar-items", spaceAccess(), async (c) => {
    const { space } = c.get("access");

    const items = await getUISidebarItems(c.env.DB, space.id);
    return c.json({ items });
  });
