import { createEffect, onCleanup } from 'solid-js';
import { parseRoute } from './useRouter';
import { findSpaceByIdentifier, getSpaceIdentifier } from '../lib/spaces';
import type { TranslationKey } from '../i18n';
import type { RouteState, View, Space } from '../types';

/**
 * Resolves /app/:appId routes by looking up the app and redirecting
 * to the appropriate view (external URL, internal route, or fallback).
 */
export function useAppRouteResolver(options: {
  authState: string;
  route: RouteState;
  hasInvalidSpaceRoute: boolean;
  routeSpaceId: string | undefined;
  selectedSpaceId: string | null;
  preferredSpaceId: string | undefined;
  spaces: Space[];
  replace: (state: RouteState) => void;
  t: (key: TranslationKey) => string;
}) {
  const {
    authState,
    route,
    hasInvalidSpaceRoute,
    routeSpaceId,
    selectedSpaceId,
    preferredSpaceId,
    spaces,
    replace,
    t,
  } = options;

  createEffect(() => {
    if (authState !== 'authenticated') return;
    if (route.view !== 'app' || !route.appId) return;
    if (hasInvalidSpaceRoute) return;

    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    const resolveAppRoute = async () => {
      try {
        const response = await fetch(`/api/apps/${encodeURIComponent(route.appId!)}`, {
          headers: {
            Accept: 'application/json',
            ...(route.spaceId ? { 'X-Takos-Space-Id': route.spaceId } : {}),
          },
        });
        if (!response.ok) {
          throw new Error('App lookup failed');
        }
        const data = await response.json() as {
          app?: {
            url?: string | null;
            space_id?: string | null;
          };
        };
        if (cancelled) return;

        const appUrl = typeof data.app?.url === 'string' ? data.app.url : '';
        if (/^https?:\/\//.test(appUrl)) {
          try {
            const parsed = new URL(appUrl);
            if (parsed.origin !== window.location.origin) {
              console.error('Blocked redirect to external origin:', parsed.origin);
              return;
            }
            window.location.assign(appUrl);
          } catch {
            console.error('Blocked redirect to invalid URL:', appUrl);
          }
          return;
        }

        if (appUrl.startsWith('/')) {
          const parsedRoute = parseRoute(appUrl);
          const contextSpaceId =
            routeSpaceId
            ?? selectedSpaceId
            ?? preferredSpaceId;
          const spaceScopedViews = new Set<View>([
            'chat',
            'repos',
            'storage',
            'deploy',
            'apps',
            'space-settings',
          ]);
          if (!parsedRoute.spaceId && contextSpaceId && spaceScopedViews.has(parsedRoute.view)) {
            parsedRoute.spaceId = contextSpaceId;
          }
          replace(parsedRoute);
          return;
        }

        const spaceId = data.app?.space_id ?? undefined;
        if (spaceId) {
          const space = findSpaceByIdentifier(spaces, spaceId, t('personal'));
          const targetSpaceId = space ? getSpaceIdentifier(space) : spaceId;
          replace({ view: 'deploy', spaceId: targetSpaceId, deploySection: 'workers' });
          return;
        }
      } catch {
        // Fall through to space apps when route cannot be resolved.
      }

      if (!cancelled) {
        const fallbackSpaceId =
          routeSpaceId
          ?? route.spaceId
          ?? selectedSpaceId
          ?? preferredSpaceId;
        replace({ view: 'apps', spaceId: fallbackSpaceId ?? undefined });
      }
    };

    void resolveAppRoute();
  });
}
