import { useEffect } from 'react';
import { parseRoute } from './useRouter';
import { findWorkspaceByIdentifier, getWorkspaceIdentifier } from '../lib/workspaces';
import type { TranslationKey } from '../i18n';
import type { RouteState, View, Workspace } from '../types';

/**
 * Resolves /app/:appId routes by looking up the app and redirecting
 * to the appropriate view (external URL, internal route, or fallback).
 */
export function useAppRouteResolver(options: {
  authState: string;
  route: RouteState;
  hasInvalidWorkspaceRoute: boolean;
  routeWorkspaceId: string | undefined;
  selectedWorkspaceId: string | null;
  preferredWorkspaceId: string | undefined;
  workspaces: Workspace[];
  replace: (state: RouteState) => void;
  t: (key: TranslationKey) => string;
}) {
  const {
    authState,
    route,
    hasInvalidWorkspaceRoute,
    routeWorkspaceId,
    selectedWorkspaceId,
    preferredWorkspaceId,
    workspaces,
    replace,
    t,
  } = options;

  useEffect(() => {
    if (authState !== 'authenticated') return;
    if (route.view !== 'app' || !route.appId) return;
    if (hasInvalidWorkspaceRoute) return;

    let cancelled = false;
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
          const contextWorkspaceId =
            routeWorkspaceId
            ?? selectedWorkspaceId
            ?? preferredWorkspaceId;
          const workspaceScopedViews = new Set<View>([
            'chat',
            'repos',
            'storage',
            'deploy',
            'apps',
            'space-settings',
          ]);
          if (!parsedRoute.spaceId && contextWorkspaceId && workspaceScopedViews.has(parsedRoute.view)) {
            parsedRoute.spaceId = contextWorkspaceId;
          }
          replace(parsedRoute);
          return;
        }

        const spaceId = data.app?.space_id ?? undefined;
        if (spaceId) {
          const workspace = findWorkspaceByIdentifier(workspaces, spaceId, t('personal'));
          const targetWorkspaceId = workspace ? getWorkspaceIdentifier(workspace) : spaceId;
          replace({ view: 'deploy', spaceId: targetWorkspaceId, deploySection: 'workers' });
          return;
        }
      } catch {
        // Fall through to workspace apps when route cannot be resolved.
      }

      if (!cancelled) {
        const fallbackWorkspaceId =
          routeWorkspaceId
          ?? route.spaceId
          ?? selectedWorkspaceId
          ?? preferredWorkspaceId;
        replace({ view: 'apps', spaceId: fallbackWorkspaceId ?? undefined });
      }
    };

    void resolveAppRoute();
    return () => {
      cancelled = true;
    };
  }, [authState, hasInvalidWorkspaceRoute, preferredWorkspaceId, replace, route.appId, route.view, route.spaceId, routeWorkspaceId, selectedWorkspaceId, t, workspaces]);
}
