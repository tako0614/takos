import { useCallback, useEffect, useState } from 'react';
import { DeploySection, RouteState, View, isDeploySection } from '../types';

function parseDeploySection(section: string | undefined): DeploySection | undefined {
  return isDeploySection(section) ? section : undefined;
}

const SIMPLE_TOP_LEVEL_VIEWS = {
  memory: 'memory',
} as const satisfies Partial<Record<string, View>>;

function parseLegalAndShareRoute(parts: string[]): RouteState | undefined {
  if (parts[0] === 'terms') return { view: 'legal', legalPage: 'terms' };
  if (parts[0] === 'privacy') return { view: 'legal', legalPage: 'privacy' };
  if (parts[0] === 'legal' && parts[1] === 'tokushoho') return { view: 'legal', legalPage: 'tokushoho' };
  if (parts[0] === 'share' && parts[1]) return { view: 'share', shareToken: parts[1] };
  return undefined;
}

function parseStoreRoute(parts: string[]): RouteState {
  const tab = parts[1] === 'installed' ? 'installed' : 'discover';
  return { view: 'store', storeTab: tab };
}

function parseAppsRoute(parts: string[]): RouteState {
  if (!parts[1]) return { view: 'apps' };
  return { view: 'apps', spaceId: parts[1] };
}

function parseChatRoute(parts: string[]): RouteState {
  if (parts[1] && parts[2]) return { view: 'chat', spaceId: parts[1], threadId: parts[2] };
  if (parts[1]) return { view: 'chat', spaceId: parts[1] };
  return { view: 'chat' };
}

function parseDeployRoute(parts: string[]): RouteState {
  if (parts[1] === 'w') {
    if (parts[2]) {
      return {
        view: 'deploy',
        spaceId: parts[2],
        deploySection: parseDeploySection(parts[3]) || 'workers',
      };
    }
    return { view: 'deploy', deploySection: 'workers' };
  }

  const maybeSection = parseDeploySection(parts[1]);
  if (maybeSection) {
    return { view: 'deploy', deploySection: maybeSection };
  }

  const spaceId = parts[1];
  if (spaceId) {
    return {
      view: 'deploy',
      spaceId,
      deploySection: parseDeploySection(parts[2]) || 'workers',
    };
  }

  return { view: 'deploy', deploySection: 'workers' };
}

function parseSourceAliasRoute(parts: string[]): RouteState {
  if (parts[1] === 'installed') {
    return { view: 'store', storeTab: 'installed' };
  }
  return { view: 'store', storeTab: 'discover' };
}

function parseReposRoute(parts: string[]): RouteState {
  if (parts.length >= 2) {
    return { view: 'repos', spaceId: parts[1] };
  }
  return { view: 'repos' };
}

function parseStorageRoute(parts: string[]): RouteState {
  if (!parts[1]) return { view: 'storage' };
  const storagePath = parts.length > 2 ? `/${parts.slice(2).join('/')}` : '/';
  return { view: 'storage', spaceId: parts[1], storagePath };
}

function parseAppRoute(parts: string[]): RouteState | undefined {
  const appSegment = parts[1];
  if (!appSegment) return undefined;

  switch (appSegment) {
    case 'workers':
      return { view: 'deploy', deploySection: 'workers' };
    case 'resources':
      return { view: 'deploy', deploySection: 'resources' };
    case 'repos':
      return { view: 'repos' };
    case 'store':
      return { view: 'store', storeTab: 'discover' };
    default:
      return { view: 'app', appId: appSegment };
  }
}

function parseWorkspaceAliasRoute(parts: string[]): RouteState | undefined {
  if (parts[0] !== 'w' || !parts[1]) return undefined;

  const spaceId = parts[1];

  if (parts[2] === 'repos') {
    if (parts[3]) {
      return { view: 'repo', spaceId, workspaceSlug: spaceId, repoId: parts[3] };
    }
    return { view: 'repos', spaceId, workspaceSlug: spaceId };
  }

  if (parts[2] === 'files') {
    const storagePath = parts.length > 3 ? `/${parts.slice(3).join('/')}` : '/';
    return { view: 'storage', spaceId, workspaceSlug: spaceId, storagePath };
  }

  if (parts[2] === 't' && parts[3]) {
    return { view: 'chat', spaceId, workspaceSlug: spaceId, threadId: parts[3] };
  }

  return { view: 'chat', spaceId, workspaceSlug: spaceId };
}

type TopLevelRouteParser = (parts: string[]) => RouteState | undefined;

const TOP_LEVEL_ROUTE_PARSERS: Partial<Record<string, TopLevelRouteParser>> = {
  explore: parseStoreRoute,
  source: parseSourceAliasRoute,
  apps: parseAppsRoute,
  store: parseStoreRoute,
  chat: parseChatRoute,
  deploy: parseDeployRoute,
  repos: parseReposRoute,
  storage: parseStorageRoute,
  'space-settings': (parts) => ({ view: 'space-settings', spaceId: parts[1] }),
  settings: () => ({ view: 'settings' }),
  resources: () => ({ view: 'deploy', deploySection: 'resources' }),
  workers: () => ({ view: 'deploy', deploySection: 'workers' }),
  deployments: () => ({ view: 'deploy', deploySection: 'workers' }),
  services: () => ({ view: 'deploy', deploySection: 'workers' }),
  app: parseAppRoute,
  w: parseWorkspaceAliasRoute,
};

function parseTopLevelRoute(parts: string[]): RouteState | undefined {
  const parser = parts[0] ? TOP_LEVEL_ROUTE_PARSERS[parts[0]] : undefined;
  if (!parser) {
    return undefined;
  }
  return parser(parts);
}

function applyChatSearchParams(route: RouteState, search: string): RouteState {
  if (route.view !== 'chat' || !search) {
    return route;
  }

  const params = new URLSearchParams(search);
  const runId = params.get('run') || undefined;
  const messageId = params.get('message') || undefined;

  if (!runId && !messageId) {
    return route;
  }

  return {
    ...route,
    runId,
    messageId,
  };
}

function parseOAuthRoute(parts: string[], search: string): RouteState | undefined {
  if (parts[0] !== 'oauth') return undefined;
  if (parts[1] === 'authorize') {
    return { view: 'oauth-authorize', oauthQuery: search };
  }
  if (parts[1] === 'device') {
    return { view: 'oauth-device', oauthQuery: search };
  }
  return undefined;
}

export function parseRoute(pathname: string, search = ''): RouteState {
  const parts = pathname.split('/').filter(Boolean);

  const oauthRoute = parseOAuthRoute(parts, search);
  if (oauthRoute) {
    return oauthRoute;
  }

  const legalOrShareRoute = parseLegalAndShareRoute(parts);
  if (legalOrShareRoute) {
    return legalOrShareRoute;
  }

  const simpleTopLevelView = SIMPLE_TOP_LEVEL_VIEWS[parts[0] as keyof typeof SIMPLE_TOP_LEVEL_VIEWS];
  if (simpleTopLevelView) {
    return applyChatSearchParams({ view: simpleTopLevelView }, search);
  }

  const topLevelRoute = parseTopLevelRoute(parts);
  if (topLevelRoute) {
    return applyChatSearchParams(topLevelRoute, search);
  }

  if (parts[0]?.startsWith('@')) {
    return applyChatSearchParams({ view: 'profile', username: parts[0].slice(1) }, search);
  }

  if (parts[0] && parts[1] && !parts[0].startsWith('@') && /^[a-zA-Z0-9_-]+$/.test(parts[0]) && /^[a-zA-Z0-9_-]+$/.test(parts[1])) {
    return applyChatSearchParams({ view: 'repo', username: parts[0], repoName: parts[1] }, search);
  }

  return applyChatSearchParams({ view: 'home' }, search);
}

const STATIC_VIEW_TO_PATH: Partial<Record<View, string>> = {
  memory: '/memory',
  settings: '/settings',
};

const LEGAL_PAGE_TO_PATH = new Map<string, string>([
  ['privacy', '/privacy'],
  ['tokushoho', '/legal/tokushoho'],
]);

function buildLegalPath(state: RouteState): string {
  return LEGAL_PAGE_TO_PATH.get(state.legalPage ?? '') ?? '/terms';
}

function buildSharePath(state: RouteState): string {
  return state.shareToken ? `/share/${state.shareToken}` : '/';
}

function buildStorePath(state: RouteState): string {
  if (state.storeTab && state.storeTab !== 'discover') {
    return `/store/${state.storeTab}`;
  }
  return '/store';
}

function buildChatPath(state: RouteState): string {
  const params = new URLSearchParams();
  if (state.runId) {
    params.set('run', state.runId);
  }
  if (state.messageId) {
    params.set('message', state.messageId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  if (state.spaceId && state.threadId) {
    return `/chat/${state.spaceId}/${state.threadId}${suffix}`;
  }
  if (state.spaceId) {
    return `/chat/${state.spaceId}${suffix}`;
  }
  return `/chat${suffix}`;
}

function buildDeployPath(state: RouteState): string {
  if (state.spaceId) {
    if (state.deploySection && state.deploySection !== 'workers') {
      return `/deploy/w/${state.spaceId}/${state.deploySection}`;
    }
    return `/deploy/w/${state.spaceId}`;
  }
  if (state.deploySection && state.deploySection !== 'workers') {
    return `/deploy/${state.deploySection}`;
  }
  return '/deploy';
}

function buildReposPath(state: RouteState): string {
  if (state.spaceId) {
    return `/repos/${state.spaceId}`;
  }
  return '/repos';
}

function buildAppsPath(state: RouteState): string {
  if (state.spaceId) {
    return `/apps/${state.spaceId}`;
  }
  return '/apps';
}

function buildStoragePath(state: RouteState): string {
  if (state.spaceId) {
    if (state.storagePath && state.storagePath !== '/') {
      return `/storage/${state.spaceId}${state.storagePath}`;
    }
    return `/storage/${state.spaceId}`;
  }
  return '/storage';
}

function buildRepoPath(state: RouteState): string | undefined {
  if (state.username && state.repoName) return `/${state.username}/${state.repoName}`;
  if (state.spaceId && state.repoId) return `/w/${state.spaceId}/repos/${state.repoId}`;
  return undefined;
}

function buildAppPath(state: RouteState): string | undefined {
  if (state.appId) {
    return `/app/${state.appId}`;
  }
  return undefined;
}

function buildProfilePath(state: RouteState): string | undefined {
  if (state.username) {
    return `/@${state.username}`;
  }
  return undefined;
}

function buildOAuthAuthorizePath(state: RouteState): string {
  return state.oauthQuery ? `/oauth/authorize${state.oauthQuery}` : '/oauth/authorize';
}

function buildOAuthDevicePath(state: RouteState): string {
  return state.oauthQuery ? `/oauth/device${state.oauthQuery}` : '/oauth/device';
}

const DYNAMIC_VIEW_TO_PATH: Partial<Record<View, (state: RouteState) => string | undefined>> = {
  'oauth-authorize': buildOAuthAuthorizePath,
  'oauth-device': buildOAuthDevicePath,
  legal: buildLegalPath,
  share: buildSharePath,
  store: buildStorePath,
  chat: buildChatPath,
  deploy: buildDeployPath,
  repos: buildReposPath,
  apps: buildAppsPath,
  storage: buildStoragePath,
  'space-settings': (state) => state.spaceId ? `/space-settings/${state.spaceId}` : '/space-settings',
  repo: buildRepoPath,
  app: buildAppPath,
  profile: buildProfilePath,
};

export function buildPath(state: RouteState): string {
  const view = state.view;

  const staticPath = STATIC_VIEW_TO_PATH[view as keyof typeof STATIC_VIEW_TO_PATH];
  if (staticPath !== undefined) {
    return staticPath;
  }

  const dynamicBuilder = DYNAMIC_VIEW_TO_PATH[view as keyof typeof DYNAMIC_VIEW_TO_PATH];
  if (dynamicBuilder) {
    const dynamicPath = dynamicBuilder(state);
    if (dynamicPath !== undefined) {
      return dynamicPath;
    }
  }

  return '/';
}

export function useRouter() {
  const [route, setRouteState] = useState<RouteState>(() => parseRoute(window.location.pathname, window.location.search));

  useEffect(() => {
    const handlePopState = () => {
      setRouteState(parseRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((newState: Partial<RouteState>) => {
    const merged = { ...route, ...newState };
    const path = buildPath(merged);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setRouteState(merged);
  }, [route]);

  const replace = useCallback((newState: RouteState) => {
    const path = buildPath(newState);
    window.history.replaceState(null, '', path);
    setRouteState(newState);
  }, []);

  return { route, navigate, replace };
}
