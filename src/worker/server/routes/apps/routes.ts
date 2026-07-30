import type { Hono } from "hono";
import type { Env, User } from "../../../shared/types/index.ts";
import type { AccountsBearerAuthContext } from "../../middleware/accounts-bearer.ts";
import {
  getRequestedSpaceIdentifier,
  requireSpaceAccess,
} from "../route-auth.ts";
import { AuthenticationError, NotFoundError } from "@takos/worker-platform-utils/errors";
import { fetchAuthorizedUiSurfaceInterfaces } from "../../../application/services/platform/runtime-interface-client.ts";
import { resolveRuntimeInterfaceAuthorization } from "../../../application/services/platform/runtime-interface-authorization.ts";
import {
  projectAuthorizedUiSurface,
  type AuthorizedUiSurface,
} from "../../../application/services/platform/runtime-interface-profiles.ts";
import {
  resolveDisplayIcon,
} from "takosumi-contract";

type Variables = {
  user?: User;
  accounts_bearer?: AccountsBearerAuthContext;
};

/**
 * App type definitions for unified framework
 */
export type AppType = "platform" | "custom";

type PublicApp = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  app_type: AppType;
  url: string | null;
  space_id: string | null;
  space_name: string | null;
  service_hostname: string | null;
  service_status: string | null;
  source_type: "interface";
  capsule_id: string | null;
  interface_name: string;
  category: string | null;
  sort_order: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const FEATURED_APP_ICON = "";

export const appsRouteDeps = {
  requireSpaceAccess,
  resolveRuntimeInterfaceAuthorization,
  fetchAuthorizedUiSurfaceInterfaces,
};

async function resolveAppsSpaceScope(
  c: { req: { header: (name: string) => string | undefined } },
  requireAccess: () => ReturnType<typeof requireSpaceAccess>,
): Promise<{ identifier: string } | null> {
  const spaceIdentifier = getRequestedSpaceIdentifier(
    c as Parameters<typeof getRequestedSpaceIdentifier>[0],
  );
  if (!spaceIdentifier) {
    return null;
  }

  await requireAccess();

  return {
    identifier: spaceIdentifier,
  };
}

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function resolveLauncherIcon(
  icon: string | null,
  baseUrl: string | null,
): string | null {
  const resolved = resolveDisplayIcon(icon, baseUrl ?? undefined);
  if (!resolved) return null;
  return resolved.kind === "image" ? resolved.url : resolved.glyph;
}

function uiSurfaceToPublicApp(
  surface: AuthorizedUiSurface,
  localSpaceIdentifier: string | null,
  capsuleId: string,
): PublicApp {
  return {
    id: surface.id,
    name: surface.name,
    description: surface.description,
    icon: surface.icon ?? FEATURED_APP_ICON,
    app_type: "custom",
    url: surface.url,
    space_id: localSpaceIdentifier,
    space_name: null,
    service_hostname: hostnameFromUrl(surface.url),
    service_status: "ready",
    source_type: "interface",
    capsule_id: capsuleId,
    interface_name: surface.interfaceName,
    category: surface.category,
    sort_order: surface.sortOrder,
    created_at: surface.createdAt,
    updated_at: surface.updatedAt,
  };
}

function sortPublicApps(apps: PublicApp[]): PublicApp[] {
  return apps.sort((left, right) => {
    const sortLeft = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sortRight = right.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sortLeft !== sortRight) return sortLeft - sortRight;
    return left.name.localeCompare(right.name);
  });
}

/**
 * Register App API routes (requires authentication)
 */
export function registerAppApiRoutes<V extends Variables>(
  api: Hono<{ Bindings: Env; Variables: V }>,
) {
  const listAuthorizedApps = async (
    env: Env,
    user: User,
    localSpaceIdentifier: string | null,
    accountsBearer?: Variables["accounts_bearer"],
  ): Promise<PublicApp[]> => {
    const authorization =
      await appsRouteDeps.resolveRuntimeInterfaceAuthorization(
        env,
        user.id,
        accountsBearer,
      );
    const authorized =
      await appsRouteDeps.fetchAuthorizedUiSurfaceInterfaces(
        authorization.workspaceId,
        authorization,
      );
    return sortPublicApps(
      authorized
        .map((entry) => ({
          surface: projectAuthorizedUiSurface(entry),
          capsuleId: entry.capsuleId,
        }))
        .filter(
          (
            entry,
          ): entry is {
            surface: AuthorizedUiSurface;
            capsuleId: string;
          } => entry.surface !== null,
        )
        .map(({ surface, capsuleId }) =>
          uiSurfaceToPublicApp(
            surface,
            localSpaceIdentifier,
            capsuleId,
          ),
        ),
    );
  };

  // List registered apps.
  api.get("/apps", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const spaceScope = await resolveAppsSpaceScope(c, () =>
      appsRouteDeps.requireSpaceAccess(
        c,
        getRequestedSpaceIdentifier(c) || "",
        user.id,
      ),
    );
    const accountsBearer = c.get("accounts_bearer");
    const apps = await listAuthorizedApps(
      c.env,
      user,
      spaceScope?.identifier ?? null,
      accountsBearer,
    );

    return c.json({ apps });
  });

  // Get single app info
  api.get("/apps/:id", async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }
    const appId = c.req.param("id");
    const spaceScope = await resolveAppsSpaceScope(c, () =>
      appsRouteDeps.requireSpaceAccess(
        c,
        getRequestedSpaceIdentifier(c) || "",
        user.id,
      ),
    );
    const app = (
      await listAuthorizedApps(
        c.env,
        user,
        spaceScope?.identifier ?? null,
        c.get("accounts_bearer"),
      )
    ).find((candidate) => candidate.id === appId);
    if (app) {
      return c.json({ app });
    }

    throw new NotFoundError("App");
  });
}
