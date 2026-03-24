import React, { useCallback } from 'react';
import { LoadingScreen } from './components/common/LoadingScreen';
import { ToastProvider } from './components/common/Toast';
import { ConfirmDialogProvider } from './providers/ConfirmDialogProvider';
import { SetupPage } from './views/SetupPage';
import { LoginPage } from './views/app/AuthViews';
import { AuthenticatedRoutes } from './views/AuthenticatedRoutes';
import { AppModals } from './components/layout/AppModals';
import { rpc, rpcJson } from './lib/rpc';
import { getErrorMessage } from './lib/errors';
import { getWorkspaceIdentifier } from './lib/workspaces';
import { useI18n } from './providers/I18nProvider';
import { useRouter } from './hooks/useRouter';
import { useAppRouteResolver } from './hooks/useAppRouteResolver';
import type { Workspace } from './types';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModalProvider, useModals } from './contexts/ModalContext';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { MobileHeaderProvider } from './contexts/MobileHeaderContext';

import { SourcePage } from './views/source/SourcePage';
import { RepoDetailPage } from './views/repos/RepoDetailPage';
import { LegalPage } from './views/legal/LegalPage';
import { SharedThreadPage } from './views/share/SharedThreadPage';
import { OAuthConsentView } from './views/oauth/OAuthConsentView';
import { DeviceAuthView } from './views/oauth/DeviceAuthView';

function AppContent() {
  const { t } = useI18n();

  const {
    authState,
    user,
    workspaces,
    workspacesLoaded,
    fetchUser,
    fetchWorkspaces,
    handleLogin,
    handleLogout: authLogout,
    redirectToLogin,
  } = useAuth();

  const { setShowCreateWorkspace } = useModals();

  const {
    route,
    navigate,
    replace,
    navigateToChat,
    preferredWorkspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
  } = useNavigation();

  const hasInvalidWorkspaceRoute = Boolean(route.spaceId) && !routeWorkspaceId && workspacesLoaded;

  // Resolve /app/:appId routes
  useAppRouteResolver({
    authState,
    route,
    hasInvalidWorkspaceRoute,
    routeWorkspaceId,
    selectedWorkspaceId,
    preferredWorkspaceId,
    workspaces,
    replace,
    t,
  });

  const handleCreateWorkspace = useCallback(async (name: string, description: string) => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    let workspace: Workspace;

    try {
      const res = await rpc.spaces.$post({
        json: {
          name: trimmedName,
          description: trimmedDescription || undefined,
        },
      });
      const data = await rpcJson<{ space: Workspace }>(res);
      workspace = data.space;
    } catch (error) {
      throw new Error(getErrorMessage(error, t('failedToCreate') || 'Failed to create'));
    }

    try {
      await fetchWorkspaces(user, { notifyOnError: false, throwOnError: true });
    } catch (error) {
      throw new Error(getErrorMessage(error, t('failedToLoad') || 'Failed to load'));
    }

    setShowCreateWorkspace(false);
    const identifier = getWorkspaceIdentifier(workspace);
    navigateToChat(identifier);
  }, [fetchWorkspaces, navigateToChat, setShowCreateWorkspace, t, user]);

  // Public / unauthenticated views
  const renderPublicStoreView = () => (
    <SourcePage
      workspaces={[]}
      onNavigateToRepo={(username, repoName) => navigate({ view: 'repo', username, repoName })}
      isAuthenticated={false}
      onRequireLogin={handleLogin}
    />
  );

  const renderPublicRepoView = () => {
    if ((!route.username || !route.repoName) && !route.repoId) {
      navigate({ view: 'store', storeTab: 'discover' });
      return <LoadingScreen />;
    }

    return (
      <RepoDetailPage
        repoId={route.repoId}
        username={route.username}
        repoName={route.repoName}
        onBack={() => navigate({ view: 'store', storeTab: 'discover' })}
        isAuthenticated={false}
        onRequireLogin={handleLogin}
      />
    );
  };

  // Main content routing
  const content: React.ReactNode = (() => {
    // OAuth views handle their own auth (session cookie + API redirects)
    if (route.view === 'oauth-authorize') {
      return <OAuthConsentView />;
    }
    if (route.view === 'oauth-device') {
      return <DeviceAuthView />;
    }
    if (route.view === 'legal') {
      return <LegalPage page={route.legalPage || 'terms'} />;
    }
    if (route.view === 'share') {
      return route.shareToken ? <SharedThreadPage token={route.shareToken} /> : <LoadingScreen />;
    }
    if (authState === 'loading') {
      return <LoadingScreen />;
    }
    if (authState === 'login') {
      if (route.view === 'store') {
        return renderPublicStoreView();
      }
      if (route.view === 'repo') {
        return renderPublicRepoView();
      }
      return <LoginPage onLogin={handleLogin} />;
    }
    if (user && !user.setup_completed) {
      return (
        <SetupPage
          onComplete={async () => {
            try {
              await rpc.me.settings.$patch({
                json: { setup_completed: true, auto_update_enabled: true },
              });
            } catch { /* ignored */ }
            fetchUser();
          }}
        />
      );
    }

    return <AuthenticatedRoutes />;
  })();

  return (
    <>
      {content}
      <AppModals onCreateWorkspace={handleCreateWorkspace} />
    </>
  );
}

function AppWithProviders() {
  const { workspaces, workspacesLoaded } = useAuth();
  const { route, navigate, replace } = useRouter();

  return (
    <NavigationProvider
      workspaces={workspaces}
      workspacesLoaded={workspacesLoaded}
      route={route}
      navigate={navigate}
      replace={replace}
    >
      <ModalProvider>
        <MobileHeaderProvider>
          <AppContent />
        </MobileHeaderProvider>
      </ModalProvider>
    </NavigationProvider>
  );
}

function App() {
  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <AuthProvider>
          <AppWithProviders />
        </AuthProvider>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}

export default App;
