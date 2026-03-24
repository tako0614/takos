import React, { useState } from 'react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { UserProfilePage } from './profile/UserProfilePage';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { AuthenticatedLayout } from '../components/layout/AuthenticatedLayout';
import { SetupPage } from './SetupPage';
import { MemoryPage } from './MemoryPage';
import { StoragePage } from './storage/StoragePage';
import { SettingsView } from './app/SettingsView';
import { DeployPanel } from './app/workspace/DeployPanel';
import { WorkspaceSettingsPage } from './hub/WorkspaceSettingsPage';
import { SourcePage } from './source/SourcePage';
import { ReposPanel } from './repos/ReposPanel';
import { ChatPage } from './chat/ChatPage';
import { AppsPage } from './apps/AppsPage';
import { RepoDetailPage } from './repos/RepoDetailPage';
import { findWorkspaceByIdentifier, getWorkspaceIdentifier } from '../lib/workspaces';
import { buildPath } from '../hooks/useRouter';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useI18n } from '../providers/I18nProvider';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
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
    fetchWorkspaces,
    workspaces,
    workspacesLoaded,
    handleLogin,
  } = useAuth();

  const {
    route,
    navigate,
    replace,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    preferredWorkspace,
    preferredWorkspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
    waitingForWorkspaceResolution,
    threadsByWorkspace,
    setThreadsByWorkspace,
    handleNewThreadCreated,
  } = useNavigation();

  const [deploySection, setDeploySection] = useState<DeploySection>('workers');
  const hasInvalidWorkspaceRoute = Boolean(route.spaceId) && !routeWorkspaceId && workspacesLoaded;

  const ensureCanonicalRoute = (nextRoute: RouteState): boolean => {
    const canonicalPath = buildPath(nextRoute);
    if (`${window.location.pathname}${window.location.search}` === canonicalPath) {
      return false;
    }
    replace(nextRoute);
    return true;
  };

  const renderWorkspaceRouteError = () => (
    <SurfaceMessage
      title={t('workspaceNotFound')}
      description={t('workspaceNotFoundDesc')}
    />
  );

  const renderStoreView = () => (
    <AuthenticatedLayout>
      <ErrorBoundary>
        <SourcePage
          workspaces={workspaces}
          onNavigateToRepo={(username, repoName) => navigate({ view: 'repo', username, repoName })}
          isAuthenticated
          onRequireLogin={handleLogin}
        />
      </ErrorBoundary>
    </AuthenticatedLayout>
  );

  const renderReposView = () => {
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const wsId = routeWorkspaceId ?? preferredWorkspaceId;

    if (!wsId && !workspacesLoaded) return <LoadingScreen />;
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
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    if (routeWorkspaceId && ensureCanonicalRoute({
      view: 'chat',
      spaceId: routeWorkspaceId,
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
            key={routeWorkspaceId ?? 'default'}
            workspaces={workspaces}
            userSettings={userSettings}
            initialWorkspaceId={routeWorkspaceId}
            initialThreadId={route.threadId}
            initialRunId={route.runId}
            initialMessageId={route.messageId}
            onWorkspaceChange={(spaceId) => {
              navigateToChat(spaceId);
            }}
            onThreadChange={(threadId) => {
              if (routeWorkspaceId) {
                navigateToChat(routeWorkspaceId, threadId);
              }
            }}
            onUpdateThread={(threadId, updates) => {
              setThreadsByWorkspace((prev) => {
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
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const currentDeploySection = route.deploySection
      || deploySection
      || 'workers';
    const deployWorkspaceId = routeWorkspaceId ?? selectedWorkspaceId ?? preferredWorkspaceId;

    if (!deployWorkspaceId && !workspacesLoaded) {
      return <LoadingScreen />;
    }

    if (deployWorkspaceId && ensureCanonicalRoute({
      view: 'deploy',
      spaceId: deployWorkspaceId,
      deploySection: currentDeploySection,
    })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          {deployWorkspaceId ? (
            <DeployPanel
              spaceId={deployWorkspaceId}
              workspaces={workspaces}
              activeSection={currentDeploySection}
              onSectionChange={(section) => {
                setDeploySection(section);
                navigate({ view: 'deploy', spaceId: deployWorkspaceId, deploySection: section });
              }}
              onNavigateToRepo={(username, repoName) => navigate({ view: 'repo', username, repoName })}
              user={user}
              userSettings={userSettings}
              onSettingsChange={setUserSettings}
              onWorkspacesRefresh={fetchWorkspaces}
              isMobile={isMobile}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-zinc-500">No workspace available</p>
            </div>
          )}
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderRepoView = () => {
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const backWorkspace =
      routeWorkspaceId
        ? findWorkspaceByIdentifier(workspaces, routeWorkspaceId, t('personal'))
        : preferredWorkspace;
    const backWorkspaceId = backWorkspace ? getWorkspaceIdentifier(backWorkspace) : undefined;

    if ((!route.username || !route.repoName) && !route.repoId) {
      replaceToChat();
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <RepoDetailPage
            spaceId={backWorkspaceId}
            repoId={route.repoId}
            username={route.username}
            repoName={route.repoName}
            onBack={() => {
              navigateToChat(backWorkspaceId);
            }}
            isAuthenticated
            onRequireLogin={handleLogin}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderMemoryView = () => {
    if (!preferredWorkspace) {
      return <LoadingScreen />;
    }

    return (
      <MemoryPage
        spaceId={getWorkspaceIdentifier(preferredWorkspace)}
        onBack={navigateToPreferredChat}
      />
    );
  };

  const renderStorageView = () => {
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const storageWorkspaceId = routeWorkspaceId ?? preferredWorkspaceId;

    if (!storageWorkspaceId && !workspacesLoaded) {
      return <LoadingScreen />;
    }
    if (!storageWorkspaceId) {
      return <LoadingScreen />;
    }

    if (ensureCanonicalRoute({
      view: 'storage',
      spaceId: storageWorkspaceId,
      storagePath: route.storagePath,
    })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <StoragePage
            spaceId={storageWorkspaceId}
            workspaces={workspaces}
            initialPath={route.storagePath || '/'}
            onPathChange={(path) => navigate({ view: 'storage', spaceId: storageWorkspaceId, storagePath: path })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderAppsView = () => {
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const appsWorkspaceId = routeWorkspaceId ?? preferredWorkspaceId;
    if (!appsWorkspaceId) {
      if (!workspacesLoaded) {
        return <LoadingScreen />;
      }
      return (
        <AuthenticatedLayout>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-zinc-500">No workspace available</p>
          </div>
        </AuthenticatedLayout>
      );
    }

    if (ensureCanonicalRoute({ view: 'apps', spaceId: appsWorkspaceId })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <AppsPage
            spaceId={appsWorkspaceId}
            onNavigateToStore={() => navigate({ view: 'store', storeTab: 'discover' })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderWorkspaceSettingsView = () => {
    if (waitingForWorkspaceResolution) return <LoadingScreen />;
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    const wsId = routeWorkspaceId ?? selectedWorkspaceId ?? null;
    if (ensureCanonicalRoute({
      view: 'space-settings',
      spaceId: wsId ?? undefined,
    })) {
      return <LoadingScreen />;
    }
    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <WorkspaceSettingsPage
            workspaces={workspaces}
            initialWorkspaceId={wsId}
            onWorkspaceDeleted={() => fetchWorkspaces(user)}
            onWorkspaceUpdated={() => fetchWorkspaces(user)}
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
    if (hasInvalidWorkspaceRoute) return renderWorkspaceRouteError();
    if (!route.appId) {
      replace({ view: 'apps', spaceId: preferredWorkspaceId });
    }
    return <LoadingScreen />;
  };

  const renderHomeRedirectView = () => {
    replace({ view: 'apps', spaceId: preferredWorkspaceId });
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
    'space-settings': renderWorkspaceSettingsView,
    settings: renderSettingsView,
  };

  const renderer = authenticatedViewRenderers[route.view as AuthenticatedView];
  if (renderer) {
    const rendered = renderer();
    if (rendered !== undefined) {
      return <>{rendered}</>;
    }
  }

  replace({ view: 'apps', spaceId: preferredWorkspaceId });
  return <LoadingScreen />;
}
