import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
  spaceAccess,
} from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  createWorkspace,
  deleteWorkspace,
  getOrCreatePersonalWorkspace,
  getWorkspaceModelSettings,
  listWorkspacesForUser,
  updateWorkspace,
  updateWorkspaceModel,
} from "../../../application/services/identity/spaces.ts";
import {
  DEFAULT_MODEL_ID,
  getModelBackend as getModelBackendForModel,
  isModelSelectable,
  normalizeModelId,
  resolveExecutionModel,
  resolveModelCatalog,
  resolveHistoryTokenBudget,
} from "../../../application/services/agent/index.ts";
import { getUISidebarItems } from "../../../application/services/platform/ui-extensions.ts";
import { resolveRuntimeInterfaceAuthorization } from "../../../application/services/platform/runtime-interface-authorization.ts";
import { toWorkspaceResponse } from "../../../application/services/identity/response-formatters.ts";
import { processFeaturedAppPreinstallJobs } from "../../../application/services/source/featured-app-catalog.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, desc, eq, ne } from "drizzle-orm";
import { threads } from "../../../infra/db/schema.ts";
import {
  BadRequestError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  MAX_WORKSPACE_DESCRIPTION_CHARACTERS,
  MAX_WORKSPACE_ID_CHARACTERS,
  MAX_WORKSPACE_NAME_CHARACTERS,
} from "../../../../core/workspaces/index.ts";

const VALID_SECURITY_POSTURES = ["standard", "restricted_egress"] as const;
const VALID_MODEL_BACKENDS = ["openai", "anthropic", "google"] as const;
type ModelBackend = (typeof VALID_MODEL_BACKENDS)[number];

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

async function buildModelSettingsResponse(
  env: AuthenticatedRouteEnv["Bindings"],
  model: string,
) {
  const catalog = await resolveModelCatalog(env, { currentModel: model });
  const effectiveModel = isModelSelectable(catalog, model)
    ? model
    : resolveExecutionModel(env, model);
  const modelBackend = getModelBackendForModel(effectiveModel);
  return {
    ai_model: effectiveModel,
    model: effectiveModel,
    model_backend: modelBackend,
    available_models: catalog.availableModelsByBackend,
    catalog_status: catalog.status,
    token_limit: resolveHistoryTokenBudget(
      effectiveModel,
      env.MODEL_CONTEXT_WINDOWS,
    ),
  };
}

async function validateSelectableModel(
  env: AuthenticatedRouteEnv["Bindings"],
  requestedModel: string,
) {
  const model = normalizeModelId(requestedModel);
  if (!model) {
    throw new BadRequestError("Invalid model");
  }
  const catalog = await resolveModelCatalog(env);
  if (!isModelSelectable(catalog, model)) {
    throw new BadRequestError("Model is not available");
  }
  return { model, catalog };
}

function scheduleFeaturedAppPreinstallTick(
  c: Context<AuthenticatedRouteEnv>,
  spaceId: string,
): void {
  c.executionCtx?.waitUntil(
    processFeaturedAppPreinstallJobs(c.env, {
      limit: 3,
      spaceId,
    }).catch((error) => {
      logWarn("Featured app preinstall background tick failed", {
        module: "routes/spaces",
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
}

export default new Hono<AuthenticatedRouteEnv>()
  .get("/", async (c) => {
    const user = c.get("user");

    let workspaces = await listWorkspacesForUser(c.env, user.id);

    const personalWorkspace = await getOrCreatePersonalWorkspace(
      c.env,
      user.id,
    );
    if (personalWorkspace) {
      if (
        !workspaces.some((workspace) => workspace.id === personalWorkspace.id)
      ) {
        workspaces = [
          personalWorkspace,
          ...workspaces.filter(
            (workspace) => workspace.id !== personalWorkspace.id,
          ),
        ];
      }
      scheduleFeaturedAppPreinstallTick(c, personalWorkspace.id);
    }

    return c.json({ spaces: workspaces.map(toWorkspaceResponse) });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().trim().min(1).max(MAX_WORKSPACE_NAME_CHARACTERS),
        id: z.string().trim().min(1).max(MAX_WORKSPACE_ID_CHARACTERS).regex(
          /^[A-Za-z0-9_-]+$/,
        ).optional(),
        description: z.string().max(MAX_WORKSPACE_DESCRIPTION_CHARACTERS)
          .optional(),
        installFeaturedApps: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");

      if (!body.name || body.name.trim().length === 0) {
        throw new BadRequestError("Name is required");
      }

      try {
        const workspace = await createWorkspace(
          c.env,
          user.id,
          body.name.trim(),
          {
            id: body.id,
            description: body.description,
            installFeaturedApps: body.installFeaturedApps ?? false,
          },
        );

        return c.json({ space: toWorkspaceResponse(workspace) }, 201);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create space";
        throw new BadRequestError(message);
      }
    },
  )
  .get("/me", async (c) => {
    const user = c.get("user");
    if (!(await getOrCreatePersonalWorkspace(c.env, user.id))) {
      throw new NotFoundError("Personal space");
    }
    scheduleFeaturedAppPreinstallTick(c, user.id);

    const access = await requireSpaceAccess(c, "me", user.id);

    return c.json({
      space: toWorkspaceResponse(access.space),
    });
  })
  .get("/:spaceId", spaceAccess(), async (c) => {
    const { space } = c.get("access");

    return c.json({
      space: toWorkspaceResponse(space),
    });
  })
  .get("/:spaceId/export", spaceAccess(), async (c) => {
    const { space } = c.get("access");

    const db = getDb(c.env.DB);

    const threadRows = await db
      .select({
        id: threads.id,
        title: threads.title,
        status: threads.status,
        updatedAt: threads.updatedAt,
      })
      .from(threads)
      .where(
        and(eq(threads.accountId, space.id), ne(threads.status, "deleted")),
      )
      .orderBy(desc(threads.updatedAt))
      .all();

    const exportedAt = new Date().toISOString();

    return c.json({
      space: toWorkspaceResponse(space),
      exported_at: exportedAt,
      threads: threadRows.map((thread) => ({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        updated_at: thread.updatedAt,
        export_url: `/api/threads/${thread.id}/export`,
        method: "GET" as const,
        formats: ["markdown", "json", "pdf"] as const,
      })),
      counts: {
        threads: threadRows.length,
      },
    });
  })
  .patch(
    "/:spaceId",
    spaceAccess(),
    zValidator(
      "json",
      z
        .object({
          name: z.string().trim().min(1).max(MAX_WORKSPACE_NAME_CHARACTERS)
            .optional(),
          description: z.string().max(MAX_WORKSPACE_DESCRIPTION_CHARACTERS)
            .nullable().optional(),
          ai_model: z.string().optional(),
          ai_provider: z.string().optional(),
          model_backend: z.string().optional(),
          security_posture: z.enum(VALID_SECURITY_POSTURES).optional(),
        })
        .strict(),
    ),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");
      const body = c.req.valid("json");
      const modelBackend = resolveModelBackendAlias(
        body.model_backend,
        body.ai_provider,
      );

      const updates: {
        name?: string;
        description?: string | null;
        ai_model?: string;
        model_backend?: string;
        security_posture?: "standard" | "restricted_egress";
      } = {};

      if (body.name && body.name.trim().length > 0) {
        updates.name = body.name.trim();
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }

      if (body.ai_model) {
        const { model: normalizedModel } = await validateSelectableModel(
          c.env,
          body.ai_model,
        );
        updates.ai_model = normalizedModel;

        const inferredModelBackend = getModelBackendForModel(normalizedModel);
        const modelBackendOverride = normalizeModelBackendInput(modelBackend);
        if (modelBackend && !modelBackendOverride) {
          throw new BadRequestError("Invalid model backend");
        }
        if (
          modelBackendOverride &&
          modelBackendOverride !== inferredModelBackend
        ) {
          throw new BadRequestError("Model backend does not match model");
        }
        updates.model_backend = modelBackendOverride || inferredModelBackend;
      }

      if (modelBackend) {
        const normalizedModelBackend = normalizeModelBackendInput(modelBackend);
        if (!normalizedModelBackend) {
          throw new BadRequestError("Invalid model backend");
        }
        if (!body.ai_model) {
          const currentSettings = await getWorkspaceModelSettings(
            c.env.DB,
            space.id,
          );
          const existingModel =
            normalizeModelId(currentSettings?.ai_model) || DEFAULT_MODEL_ID;
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

      const workspace = await updateWorkspace(
        c.env.DB,
        user.id,
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

    const workspace = await getWorkspaceModelSettings(c.env.DB, space.id);

    const model = normalizeModelId(workspace?.ai_model) || DEFAULT_MODEL_ID;
    return c.json(await buildModelSettingsResponse(c.env, model));
  })
  .patch(
    "/:spaceId/model",
    spaceAccess(),
    zValidator(
      "json",
      z
        .object({
          model: z.string().optional(),
          ai_model: z.string().optional(),
          provider: z.string().optional(),
          model_backend: z.string().optional(),
        })
        .strict(),
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

      const { model, catalog } = await validateSelectableModel(
        c.env,
        requestedModel,
      );

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

      if (
        !(await updateWorkspaceModel(
          c.env.DB,
          c.get("user").id,
          space.id,
          model,
          modelBackend,
        ))
      ) {
        throw new NotFoundError("Workspace");
      }

      return c.json({
        ai_model: model,
        model,
        model_backend: modelBackend,
        available_models: catalog.availableModelsByBackend,
        catalog_status: catalog.status,
        token_limit: resolveHistoryTokenBudget(
          model,
          c.env.MODEL_CONTEXT_WINDOWS,
        ),
      });
    },
  )
  .delete(
    "/:spaceId",
    spaceAccess(),
    async (c) => {
      const { space } = c.get("access");
      const user = c.get("user");

      if (!(await deleteWorkspace(c.env, user.id, space.id))) {
        throw new NotFoundError("Workspace");
      }

      return c.json({ success: true });
    },
  )
  .get("/:spaceId/sidebar-items", spaceAccess(), async (c) => {
    const authorization = await resolveRuntimeInterfaceAuthorization(
      c.env,
      c.get("user").id,
      c.get("accounts_bearer"),
    );
    const items = await getUISidebarItems(authorization);
    return c.json({ items });
  });
