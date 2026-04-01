import { type JSX, onMount } from "solid-js";
import { LoadingScreen } from "./components/common/LoadingScreen.tsx";
import { ToastRenderer } from "./components/common/Toast.tsx";
import { ConfirmDialogRenderer } from "./components/common/ConfirmDialog.tsx";
import { SetupPage } from "./views/SetupPage.tsx";
import { LoginPage } from "./views/app/AuthViews.tsx";
import { AuthenticatedRoutes } from "./views/AuthenticatedRoutes.tsx";
import { AppModals } from "./components/layout/AppModals.tsx";
import { rpc, rpcJson } from "./lib/rpc.ts";
import { getErrorMessage } from "./lib/errors.ts";
import { getSpaceIdentifier } from "./lib/spaces.ts";
import { useI18n } from "./store/i18n.ts";

import { useAppRouteResolver } from "./hooks/useAppRouteResolver.ts";
import type { Space } from "./types/index.ts";

import { useAuth } from "./hooks/useAuth.ts";
import { useSetAtom } from "solid-jotai";
import { showCreateSpaceAtom } from "./store/modal.ts";
import { useNavigation, useNavigationSync } from "./store/navigation.ts";

import { SourcePage } from "./views/source/SourcePage.tsx";
import { RepoDetailPage } from "./views/repos/RepoDetailPage.tsx";
import { LegalPage } from "./views/legal/LegalPage.tsx";
import { SharedThreadPage } from "./views/share/SharedThreadPage.tsx";
import { OAuthConsentView } from "./views/oauth/OAuthConsentView.tsx";
import { DeviceAuthView } from "./views/oauth/DeviceAuthView.tsx";

function AppContent() {
  const { t } = useI18n();

  const {
    authState,
    user,
    spaces,
    spacesLoaded,
    fetchUser,
    fetchSpaces,
    handleLogin,
  } = useAuth();

  const setShowCreateSpace = useSetAtom(showCreateSpaceAtom);

  const {
    route,
    navigate,
    replace,
    navigateToChat,
    preferredSpaceId,
    routeSpaceId,
    selectedSpaceId,
  } = useNavigation();

  const hasInvalidSpaceRoute = Boolean(route.spaceId) && !routeSpaceId &&
    spacesLoaded;

  // Resolve /app/:appId routes
  useAppRouteResolver({
    authState,
    route,
    hasInvalidSpaceRoute,
    routeSpaceId,
    selectedSpaceId,
    preferredSpaceId,
    spaces,
    replace,
    t,
  });

  const handleCreateSpace = async (name: string, description: string) => {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    let space: Space;

    try {
      const res = await rpc.spaces.$post({
        json: {
          name: trimmedName,
          description: trimmedDescription || undefined,
        },
      });
      const data = await rpcJson<{ space: Space }>(res);
      space = data.space;
    } catch (error) {
      throw new Error(
        getErrorMessage(error, t("failedToCreate") || "Failed to create"),
      );
    }

    try {
      await fetchSpaces(user, { notifyOnError: false, throwOnError: true });
    } catch (error) {
      throw new Error(
        getErrorMessage(error, t("failedToLoad") || "Failed to load"),
      );
    }

    setShowCreateSpace(false);
    const identifier = getSpaceIdentifier(space);
    navigateToChat(identifier);
  };

  // Public / unauthenticated views
  const renderPublicStoreView = () => (
    <SourcePage
      spaces={[]}
      onNavigateToRepo={(username, repoName) =>
        navigate({ view: "repo", username, repoName })}
      isAuthenticated={false}
      onRequireLogin={handleLogin}
    />
  );

  const renderPublicRepoView = () => {
    if ((!route.username || !route.repoName) && !route.repoId) {
      navigate({ view: "store", storeTab: "discover" });
      return <LoadingScreen />;
    }

    return (
      <RepoDetailPage
        repoId={route.repoId}
        username={route.username}
        repoName={route.repoName}
        initialFilePath={route.filePath}
        initialFileLine={route.fileLine}
        initialRef={route.ref}
        onBack={() => navigate({ view: "store", storeTab: "discover" })}
        isAuthenticated={false}
        onRequireLogin={handleLogin}
      />
    );
  };

  // Main content routing
  const content: JSX.Element = (() => {
    // OAuth views handle their own auth (session cookie + API redirects)
    if (route.view === "oauth-authorize") {
      return <OAuthConsentView />;
    }
    if (route.view === "oauth-device") {
      return <DeviceAuthView />;
    }
    if (route.view === "legal") {
      return <LegalPage page={route.legalPage || "terms"} />;
    }
    if (route.view === "share") {
      return route.shareToken
        ? <SharedThreadPage token={route.shareToken} />
        : <LoadingScreen />;
    }
    if (authState === "loading") {
      return <LoadingScreen />;
    }
    if (authState === "login") {
      if (route.view === "store") {
        return renderPublicStoreView();
      }
      if (route.view === "repo") {
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
      <AppModals onCreateSpace={handleCreateSpace} />
    </>
  );
}

function AppWithProviders() {
  const { fetchUser } = useAuth();

  // Sync useRouter + breakpoint state into navigation atoms (replaces NavigationProvider)
  useNavigationSync();

  // Initialize auth state on mount (replaces AuthProvider)
  onMount(() => {
    void fetchUser();
  });

  return <AppContent />;
}

function App() {
  return (
    <>
      <AppWithProviders />
      <ConfirmDialogRenderer />
      <ToastRenderer />
    </>
  );
}

export default App;
