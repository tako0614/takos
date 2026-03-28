import React, { useState } from 'react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { UserProfilePage } from './profile/UserProfilePage';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { AuthenticatedLayout } from '../components/layout/AuthenticatedLayout';
import { SetupPage } from './SetupPage';
import { MemoryPage } from './MemoryPage';
import { StoragePage } from './storage/StoragePage';
import { SettingsView } from './app/SettingsView';
import { DeployPanel } from './app/space/DeployPanel';
import { SpaceSettingsPage } from './hub/SpaceSettingsPage';
import { SourcePage } from './source/SourcePage';
import { ReposPanel } from './repos/ReposPanel';
import { ChatPage } from './chat/ChatPage';
import { AppsPage } from './apps/AppsPage';
import { RepoDetailPage } from './repos/RepoDetailPage';
import { findSpaceByIdentifier, getSpaceIdentifier } from '../lib/spaces';
import { buildPath } from '../hooks/useRouter';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useI18n } from '../store/i18n';
import { useAuth } from '../hooks/useAuth';
import { useNavigation } from '../store/navigation';
import type { DeploySection, RouteState, Thread, View } from '../types';

function SurfaceMessage({ title, description }: { title: string; description?: string }) {
  return (
    <AuthenticatedLayout>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
          {description ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
          ) : null}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}

export function AuthenticatedRoutes() {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const {
    user,
    userSettings,
    setUserSettings,
    fetchUser,
    fetchSpaces,
    spaces,
    spacesLoaded,
    handleLogin,
  } = useAuth();

  const {
    route,
    navigate,
    replace,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    preferredSpace,
    preferredSpaceId,
    routeSpaceId,
    selectedSpaceId,
    waitingForSpaceResolution,
    threadsBySpace,
    setThreadsBySpace,
    handleNewThreadCreated,
  } = useNavigation();

  const [deploySection, setDeploySection] = useState<DeploySection>('workers');
  const hasInvalidSpaceRoute = Boolean(route.spaceId) && !routeSpaceId && spacesLoaded;

  const ensureCanonicalRoute = (nextRoute: RouteState): boolean => {
    const canonicalPath = buildPath(nextRoute);
    if (`${window.location.pathname}${window.location.search}` === canonicalPath) {
      return false;
    }
    replace(nextRoute);
    return true;
  };

  const renderSpaceRouteError = () => (
    <SurfaceMessage
      title={t('spaceNotFound')}
      description={t('spaceNotFoundDesc')}
    />
  );

  const renderStoreView = () => (
    <AuthenticatedLayout>
      <ErrorBoundary>
        <SourcePage
          spaces={spaces}
          onNavigateToRepo={(username, repoName) => navigate({ view: 'repo', username, repoName })}
          isAuthenticated
          onRequireLogin={handleLogin}
        />
      </ErrorBoundary>
    </AuthenticatedLayout>
  );

  const renderReposView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const wsId = routeSpaceId ?? preferredSpaceId;

    if (!wsId && !spacesLoaded) return <LoadingScreen />;
    if (!wsId) return <LoadingScreen />;

    if (ensureCanonicalRoute({ view: 'repos', spaceId: wsId })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <ReposPanel
            spaceId={wsId}
            onNavigateToRepo={(username, repoName) => navigate({ view: 'repo', username, repoName })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderChatView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    if (routeSpaceId && ensureCanonicalRoute({
      view: 'chat',
      spaceId: routeSpaceId,
      threadId: route.threadId,
      runId: route.runId,
      messageId: route.messageId,
    })) {
      return <LoadingScreen />;
    }
    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <ChatPage
            key={routeSpaceId ?? 'default'}
            spaces={spaces}
            initialSpaceId={routeSpaceId}
            initialThreadId={route.threadId}
            initialRunId={route.runId}
            initialMessageId={route.messageId}
            onSpaceChange={(spaceId) => {
              navigateToChat(spaceId);
            }}
            onThreadChange={(threadId) => {
              if (routeSpaceId) {
                navigateToChat(routeSpaceId, threadId);
              }
            }}
            onUpdateThread={(threadId, updates) => {
              setThreadsBySpace((prev) => {
                const next: Record<string, Thread[]> = {};
                for (const key of Object.keys(prev)) {
                  next[key] = prev[key].map((th) => th.id === threadId ? { ...th, ...updates } : th);
                }
                return next;
              });
            }}
            onNewThreadCreated={handleNewThreadCreated}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderDeployView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const currentDeploySection = route.deploySection
      || deploySection
      || 'workers';
    const deploySpaceId = routeSpaceId ?? selectedSpaceId ?? preferredSpaceId;

    if (!deploySpaceId && !spacesLoaded) {
      return <LoadingScreen />;
    }

    if (deploySpaceId && ensureCanonicalRoute({
      view: 'deploy',
      spaceId: deploySpaceId,
      deploySection: currentDeploySection,
    })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          {deploySpaceId ? (
            <DeployPanel
              spaceId={deploySpaceId}
              spaces={spaces}
              activeSection={currentDeploySection}
              onSectionChange={(section) => {
                setDeploySection(section);
                navigate({ view: 'deploy', spaceId: deploySpaceId, deploySection: section });
              }}
              user={user}
              userSettings={userSettings}
              onSettingsChange={setUserSettings}
              onSpacesRefresh={fetchSpaces}
              isMobile={isMobile}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-zinc-500">No space available</p>
            </div>
          )}
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderRepoView = () => {
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const backSpace =
      routeSpaceId
        ? findSpaceByIdentifier(spaces, routeSpaceId, t('personal'))
        : preferredSpace;
    const backSpaceId = backSpace ? getSpaceIdentifier(backSpace) : undefined;

    if ((!route.username || !route.repoName) && !route.repoId) {
      replaceToChat();
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <RepoDetailPage
            spaceId={backSpaceId}
            repoId={route.repoId}
            username={route.username}
            repoName={route.repoName}
            onBack={() => {
              navigateToChat(backSpaceId);
            }}
            isAuthenticated
            onRequireLogin={handleLogin}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderMemoryView = () => {
    if (!preferredSpace) {
      return <LoadingScreen />;
    }

    return (
      <MemoryPage
        spaceId={getSpaceIdentifier(preferredSpace)}
        onBack={navigateToPreferredChat}
      />
    );
  };

  const renderStorageView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const storageSpaceId = routeSpaceId ?? preferredSpaceId;

    if (!storageSpaceId && !spacesLoaded) {
      return <LoadingScreen />;
    }
    if (!storageSpaceId) {
      return <LoadingScreen />;
    }

    if (ensureCanonicalRoute({
      view: 'storage',
      spaceId: storageSpaceId,
      storagePath: route.storagePath,
    })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <StoragePage
            spaceId={storageSpaceId}
            spaces={spaces}
            initialPath={route.storagePath || '/'}
            onPathChange={(path) => navigate({ view: 'storage', spaceId: storageSpaceId, storagePath: path })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderAppsView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const appsSpaceId = routeSpaceId ?? preferredSpaceId;
    if (!appsSpaceId) {
      if (!spacesLoaded) {
        return <LoadingScreen />;
      }
      return (
        <AuthenticatedLayout>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-500">No space available</p>
          </div>
        </AuthenticatedLayout>
      );
    }

    if (ensureCanonicalRoute({ view: 'apps', spaceId: appsSpaceId })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <AppsPage
            onNavigateToStore={() => navigate({ view: 'store', storeTab: 'discover' })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderSpaceSettingsView = () => {
    if (waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    const wsId = routeSpaceId ?? selectedSpaceId ?? null;
    if (ensureCanonicalRoute({
      view: 'space-settings',
      spaceId: wsId ?? undefined,
    })) {
      return <LoadingScreen />;
    }
    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <SpaceSettingsPage
            spaces={spaces}
            initialSpaceId={wsId}
            onSpaceDeleted={() => fetchSpaces(user)}
            onSpaceUpdated={() => fetchSpaces(user)}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderSettingsView = () => (
    <AuthenticatedLayout>
      <ErrorBoundary>
        <SettingsView
          user={user}
          userSettings={userSettings}
          onSettingsChange={setUserSettings}
          onBack={() => navigateToPreferredChat()}
        />
      </ErrorBoundary>
    </AuthenticatedLayout>
  );

  const renderLegacyAppView = () => {
    if (hasInvalidSpaceRoute) return renderSpaceRouteError();
    if (!route.appId) {
      replace({ view: 'apps', spaceId: preferredSpaceId });
    }
    return <LoadingScreen />;
  };

  const renderHomeRedirectView = () => {
    replace({ view: 'apps', spaceId: preferredSpaceId });
    return <LoadingScreen />;
  };

  const renderProfileView = (): React.ReactNode | undefined => {
    if (!route.username) {
      return undefined;
    }

    return (
      <UserProfilePage
        username={route.username}
        onBack={navigateToPreferredChat}
        onNavigateToProfile={(username) => navigate({ view: 'profile', username })}
        onNavigateToRepo={(username, repoName) => {
          navigate({ view: 'repo', username, repoName });
        }}
      />
    );
  };

  type AuthenticatedView = View;
  type AuthenticatedViewRenderer = () => React.ReactNode | undefined;

  const authenticatedViewRenderers: Partial<Record<AuthenticatedView, AuthenticatedViewRenderer>> = {
    home: renderHomeRedirectView,
    store: renderStoreView,
    repos: renderReposView,
    chat: renderChatView,
    deploy: renderDeployView,
    repo: renderRepoView,
    profile: renderProfileView,
    memory: renderMemoryView,
    storage: renderStorageView,
    apps: renderAppsView,
    app: renderLegacyAppView,
    'space-settings': renderSpaceSettingsView,
    settings: renderSettingsView,
  };

  const renderer = authenticatedViewRenderers[route.view as AuthenticatedView];
  if (renderer) {
    const rendered = renderer();
    if (rendered !== undefined) {
      return <>{rendered}</>;
    }
  }

  replace({ view: 'apps', spaceId: preferredSpaceId });
  return <LoadingScreen />;
}
