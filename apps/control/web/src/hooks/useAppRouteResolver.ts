import { createMemo, createResource } from "solid-js";
import type { Accessor } from "solid-js";
import { parseRoute } from "./router-state.ts";
import { resolveAppUrl } from "./app-route-resolution.ts";
import { findSpaceByIdentifier, getSpaceIdentifier } from "../lib/spaces.ts";
import type { RouteState, Space, View } from "../types/index.ts";

export interface AppRouteResolution {
  targetRoute: RouteState | null;
  externalHref: string | null;
}

export function useAppRouteResolver(options: {
  authState: Accessor<string>;
  route: Accessor<RouteState>;
  hasInvalidSpaceRoute: Accessor<boolean>;
  routeSpaceId: Accessor<string | undefined>;
  selectedSpaceId: Accessor<string | null>;
  preferredSpaceId: Accessor<string | undefined>;
  spaces: Accessor<Space[]>;
  personalLabel: Accessor<string>;
}) {
  const source = createMemo(() => {
    const authState = options.authState();
    const route = options.route();
    const hasInvalidSpaceRoute = options.hasInvalidSpaceRoute();

    if (authState !== "authenticated") return null;
    if (route.view !== "app" || !route.appId) return null;
    if (hasInvalidSpaceRoute) return null;

    return {
      appId: route.appId,
      requestSpaceId: route.spaceId,
      routeSpaceId: options.routeSpaceId(),
      selectedSpaceId: options.selectedSpaceId(),
      preferredSpaceId: options.preferredSpaceId(),
      spaces: options.spaces(),
      personalLabel: options.personalLabel(),
    };
  });

  const [resolution] = createResource(source, async (current) => {
    if (!current) {
      return null;
    }

    const fallbackSpaceId = current.routeSpaceId ??
      current.requestSpaceId ??
      current.selectedSpaceId ??
      current.preferredSpaceId;

    try {
      const response = await fetch(
        `/api/apps/${encodeURIComponent(current.appId)}`,
        {
          headers: {
            Accept: "application/json",
            ...(current.requestSpaceId
              ? { "X-Takos-Space-Id": current.requestSpaceId }
              : {}),
          },
        },
      );
      if (!response.ok) {
        throw new Error("App lookup failed");
      }
      const data = await response.json() as {
        app?: {
          url?: string | null;
          space_id?: string | null;
        };
      };

      const appUrl = typeof data.app?.url === "string" ? data.app.url : "";
      const resolvedAppUrl = resolveAppUrl(
        appUrl,
        globalThis.location.origin,
      );
      if (resolvedAppUrl.kind === "redirect") {
        return {
          targetRoute: null,
          externalHref: resolvedAppUrl.href,
        } satisfies AppRouteResolution;
      }
      if (resolvedAppUrl.kind === "route") {
        const parsedRoute = parseRoute(
          resolvedAppUrl.path,
          resolvedAppUrl.search,
        );
        const contextSpaceId = current.routeSpaceId ??
          current.selectedSpaceId ??
          current.preferredSpaceId;
        const spaceScopedViews = new Set<View>([
          "chat",
          "repos",
          "storage",
          "deploy",
          "apps",
          "space-settings",
        ]);
        if (
          !parsedRoute.spaceId && contextSpaceId &&
          spaceScopedViews.has(parsedRoute.view)
        ) {
          parsedRoute.spaceId = contextSpaceId;
        }
        return {
          targetRoute: parsedRoute,
          externalHref: null,
        } satisfies AppRouteResolution;
      }
      if (/^https?:\/\//i.test(appUrl)) {
        console.error("Blocked redirect to external or invalid URL:", appUrl);
      }

      const spaceId = data.app?.space_id ?? undefined;
      if (spaceId) {
        const space = findSpaceByIdentifier(
          current.spaces,
          spaceId,
          current.personalLabel,
        );
        const targetSpaceId = space ? getSpaceIdentifier(space) : spaceId;
        return {
          targetRoute: {
            view: "deploy",
            spaceId: targetSpaceId,
            deploySection: "workers",
          },
          externalHref: null,
        } satisfies AppRouteResolution;
      }
    } catch {
      // Fall through to the default apps route when route lookup fails.
    }

    return {
      targetRoute: {
        view: "apps",
        spaceId: fallbackSpaceId ?? undefined,
      },
      externalHref: null,
    } satisfies AppRouteResolution;
  });

  return {
    resolution: createMemo(() => source() ? resolution() : null),
    resolving: createMemo(() => Boolean(source()) && resolution.loading),
  };
}
